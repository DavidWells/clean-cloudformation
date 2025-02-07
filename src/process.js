const fs = require('fs').promises
const path = require('path')
const yaml = require('js-yaml')
const { cleanCloudFormation } = require('./')
const { getCfnYamlSchema } = require('./utils/schemas')
const { deepLog } = require('./utils/logger')

function dumpOriginalAsYaml(fileContents = '') {
  if (fileContents.trim().startsWith('{')) {
    fileContents = JSON.stringify(JSON.parse(fileContents), null, 2)
  }

  const loaded = yaml.load(fileContents, { schema: getCfnYamlSchema() })
  // return fileContents
  return yaml.dump(loaded, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    noArrayIndent: true,
    flowStyle: false,
    schema: getCfnYamlSchema()
  })
}

async function processTemplate(filePathOrObject) {
  if (typeof filePathOrObject === 'string') {
    filePathOrObject = {
      filePath: filePathOrObject,
      url: filePathOrObject,
      name: path.basename(filePathOrObject)
    }
  }

  const { url, filePath, name } = filePathOrObject

  const inputValue = url || filePath
  // Read input file
  const fileExt = path.basename(inputValue).split('.').pop()
  const fileType = fileExt === 'json' ? 'JSON' : 'YAML'

  const result = await cleanCloudFormation(inputValue, {
    asPrompt: true,
    replaceLogicalIds: [
      {
        pattern: 'Passwordless', 
        replacement: ''
      },
      {
        pattern: /Passwordless$/,
        replacement: (payload) => {
          const { logicalId, resourceDetails } = payload
          const { name } = resourceDetails
          return logicalId.replace(/Passwordless$/, '') // .replace(name, '')
        }
      },
      {
        pattern: /Passwordless/gi,
        replacement: (payload) => {
          const { logicalId, resourceDetails, pattern } = payload
          return logicalId.replace(pattern, '')
        }
      }
    ]
  })

  const {
    yaml, 
    yamlNoComments, 
  
    json, 
    prompts, 
    resourcesByCount, 
    comments,
    originalContents,
    diff
  } = result
  
  // Save both versions in parallel
  const baseName = (filePath) ? path.basename(filePath, path.extname(filePath)) : name

  // Make outputDir with baseName if it doesn't exist
  const outputDir = path.resolve(__dirname, `../outputs/${baseName}`)
  const previousDir = path.join(outputDir, 'previous')

  // Handle existing directory
  let exists = false
  try {
    await fs.access(outputDir)
    exists = true
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  if (exists) {
    // Clear out previousDir
    await fs.rm(previousDir, { recursive: true, force: true })
    
    // Create the previous directory first
    await fs.mkdir(previousDir, { recursive: true })

  
    // Read directory contents
    const files = await fs.readdir(outputDir)
    
    // Get file stats in parallel
    const fileStats = await Promise.all(
      files.map(async file => {
        try {
          const stats = await fs.stat(path.join(outputDir, file))
          return {
            file,
            isFile: stats.isFile()
          }
        } catch (err) {
          console.warn(`Could not stat ${file}:`, err)
          return {
            file,
            isFile: false
          }
        }
      })
    )

    // Filter for files only and move them
    await Promise.all(
      fileStats
        .filter(({ file, isFile }) => file !== 'previous' && isFile)
        .map(({ file }) => {
          const oldPath = path.join(outputDir, file)
          const newPath = path.join(previousDir, file)
          return fs.rename(oldPath, newPath)
        })
    )
  }

  // Create or ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true })

  // Create prompts directory
  const promptsDir = path.join(outputDir, 'prompts')
  await fs.mkdir(promptsDir, { recursive: true })

  const dirtyOutput = dumpOriginalAsYaml(originalContents)

  const outputFilePaths = {
    input: `${outputDir}/0_${baseName}-original.${fileExt}`,
    inputAsYaml: `${outputDir}/0.1_${baseName}-original-as-yaml.yml`,
    resultNoComments: `${outputDir}/2_${baseName}-no-comments.yml`,
    result: `${outputDir}/1_${baseName}.yml`,
    prompts: {
      resourceCosts: `${promptsDir}/resource-costs.md`,
      resourceNames: `${promptsDir}/resource-names.md`,
      iamSecurity: `${promptsDir}/iam-security.md`,
      json: `${promptsDir}/prompts.json`
    }
  }

  await Promise.all([
    fs.writeFile(outputFilePaths.input, originalContents),
    fs.writeFile(outputFilePaths.inputAsYaml, dirtyOutput),
    fs.writeFile(outputFilePaths.resultNoComments, yamlNoComments),
    fs.writeFile(outputFilePaths.result, yaml),
    // Write prompts to files
    fs.writeFile(outputFilePaths.prompts.resourceCosts,
`# Resource Costs Prompt
${prompts.resourceCosts}`),
    fs.writeFile(outputFilePaths.prompts.resourceNames,
`# Resource Names Prompt
${prompts.resourceNames}`),
    fs.writeFile(outputFilePaths.prompts.iamSecurity,
`# IAM Security Review Prompt
${prompts.iamSecurity}`),
    // Write prompts as JSON for programmatic use
    fs.writeFile(outputFilePaths.prompts.json,
      JSON.stringify({
        resourceCosts: prompts.resourceCosts,
        resourceNames: prompts.resourceNames,
        iamSecurity: prompts.iamSecurity
      }, null, 2)
    )
  ])

  console.log('───────────────────────────────────────────────────')
  // Log the number of lines in the cleaned and dirty files
  const cleanLines = yamlNoComments.split('\n').length
  const dirtyLines = dirtyOutput.split('\n').length
  console.log(`Line savings: ${((dirtyLines - cleanLines) / dirtyLines * 100).toFixed(2)}% reduction. Removed ${dirtyLines - cleanLines} lines.`)
  console.log(`   Output has   ${cleanLines} lines`)
  console.log(`   Original has ${dirtyLines} lines`)
  console.log('───────────────────────────────────────────────────')

  // Get file sizes
  const cleanSize = Buffer.from(yamlNoComments).length
  const dirtySize = Buffer.from(dirtyOutput).length
  const minifiedJson = JSON.stringify(json)
  const minifiedJsonSize = Buffer.from(minifiedJson).length
  const sizeSavings = ((dirtySize - minifiedJsonSize) / dirtySize) * 100

  console.log(`File size savings: ${sizeSavings.toFixed(2)}% reduction. Removed ${dirtySize - minifiedJsonSize} bytes.`)
  console.log(`Input  ${fileType}:   ${(dirtySize / 1024).toFixed(2)} KB`)
  console.log(`Output YAML:   ${(cleanSize / 1024).toFixed(2)} KB`)
  console.log(`Output JSON:   ${(minifiedJsonSize / 1024).toFixed(2)} KB`)
  console.log('───────────────────────────────────────────────────')

  // Log savings
  console.log(`Transformation complete! Output written to ${baseName}-clean.yml`)
  // console.log(prompts.resourceCosts)
  // console.log(prompts.resourceNames)
  console.log(resourcesByCount)

  // Log the diff if it exists
  if (diff) {
    console.log('\nTemplate Changes:')
    console.log('───────────────────────────────────────────────────')
    console.log(diff.patch)
    console.log('───────────────────────────────────────────────────')

    // Right out the patch file to the output directory.
    await fs.writeFile(`${outputDir}/diff.patch`, diff.patch)
    // write out the diff.patch also to a markdown file inside of the diff block
    await fs.writeFile(`${outputDir}/diff-yml.md`, `# Template Changes
# YAML DIFF

\`\`\`diff
${diff.patch}
\`\`\`

`)
    await fs.writeFile(`${outputDir}/diff-json.md`, `# Template Changes
# JSON DIFF

\`\`\`diff
${diff.diff}
\`\`\`
`)
  }

  deepLog('comments', comments)

  deepLog('nice longer sentence', { foo: 'bar', baz: 'qux' })

  deepLog({ foo: 'bar', baz: 'qux' })

  return result
}

module.exports = {
  processTemplate
}