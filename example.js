const fs = require('fs').promises
const path = require('path')
const yaml = require('js-yaml')
const { cleanCloudFormation } = require('./src')
const { getCfnSchema } = require('./src/utils/yaml-schema')

function outputDirty(fileContents) {
  return yaml.dump(yaml.load(fileContents, { schema: getCfnSchema() }), {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    noArrayIndent: true,
    flowStyle: false,
    schema: getCfnSchema()
  })
}

async function example(filePath) {
  // Read input file
  const fileExt = path.basename(filePath).split('.').pop()
  const fileType = fileExt === 'json' ? 'JSON' : 'YAML'

  const { 
    yaml, 
    yamlTwo, 
    json, 
    prompts, 
    resourcesByCount, 
    comments,
    originalContents
  } = await cleanCloudFormation(filePath, {
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
  
  // Save both versions in parallel
  const baseName = path.basename(filePath, path.extname(filePath))

  // Make outputDir with baseName if it doesn't exist
  const outputDir = path.resolve(__dirname, `outputs/${baseName}`)
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

  // clear 

  await Promise.all([
    fs.writeFile(`${outputDir}/0_${baseName}-original.${fileExt}`, originalContents),
    fs.writeFile(`${outputDir}/1_${baseName}-clean.yml`, yaml),
    fs.writeFile(`${outputDir}/2_${baseName}-clean-comments.yml`, yamlTwo),
    fs.writeFile(`${outputDir}/3_${baseName}-dirty.yml`, outputDirty(originalContents))
  ])

  console.log('───────────────────────────────────────────────────')
  // Log the number of lines in the cleaned and dirty files
  const cleanLines = yaml.split('\n').length
  const dirtyLines = outputDirty(originalContents).split('\n').length
  console.log(`Line savings: ${((dirtyLines - cleanLines) / dirtyLines * 100).toFixed(2)}% reduction. Removed ${dirtyLines - cleanLines} lines.`)
  console.log(`   Output has   ${cleanLines} lines`)
  console.log(`   Original has ${dirtyLines} lines`)
  console.log('───────────────────────────────────────────────────')

  // Get file sizes
  const cleanSize = Buffer.from(yaml).length
  const dirtySize = Buffer.from(outputDirty(originalContents)).length
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

  console.log(comments)
}

example(
  // 'https://raw.githubusercontent.com/zoph-io/serverless-aws-https-webredirect/6c99fef9218c47f80bacb1236c8f5d964834ef8b/template.yml',
  // './fixtures/broken.yml',
  './fixtures/tiny-two.yml'
  // './fixtures/serverless.yml',
  // './fixtures/stack-one.json',
  //'./fixtures/stack-one-yaml.yml',
  // './fixtures/stack-two.json',
  // './fixtures/stack-two.yml',
  // './fixtures/tiny.yml',
  //'./fixtures/stack-three.json',
  // './fixtures/stack-four.json',
  // './fixtures/cdn-cloudformation.json'
).catch(err => {
  console.error('Error:', err)
  process.exit(1)
}); 