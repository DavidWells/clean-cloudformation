const fs = require('fs').promises
const path = require('path')
const yaml = require('js-yaml')
const { cleanCloudFormation } = require('./src')

function outputDirty(fileContents) {
  return yaml.dump(yaml.load(fileContents), {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    noArrayIndent: true,
    flowStyle: false,
  })
}

async function example(filePath) {
  // Read input file
  let fileContents = await fs.readFile(filePath, 'utf8')
  const fileExt = path.basename(filePath).split('.').pop()
  const fileType = fileExt === 'json' ? 'JSON' : 'YAML'

  const { yaml, yamlTwo, json, prompts, resourcesByCount, comments } = await cleanCloudFormation(fileContents, {
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
          return logicalId.replace(/Passwordless$/, '').replace(name, '')
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
  await Promise.all([
    fs.writeFile(`outputs/${baseName}-clean.yml`, yaml),
    fs.writeFile(`outputs/${baseName}-clean-comments.yml`, yamlTwo),
    fs.writeFile(`outputs/${baseName}-dirty.yml`, outputDirty(fileContents))
  ])

  console.log('───────────────────────────────────────────────────')
  // Log the number of lines in the cleaned and dirty files
  const cleanLines = yaml.split('\n').length
  const dirtyLines = outputDirty(fileContents).split('\n').length
  console.log(`Line savings: ${((dirtyLines - cleanLines) / dirtyLines * 100).toFixed(2)}% reduction. Removed ${dirtyLines - cleanLines} lines.`)
  console.log(`   Output has   ${cleanLines} lines`)
  console.log(`   Original has ${dirtyLines} lines`)
  console.log('───────────────────────────────────────────────────')

  // Get file sizes
  const cleanSize = Buffer.from(yaml).length
  const dirtySize = Buffer.from(outputDirty(fileContents)).length
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
  // './fixtures/stack-one.json',
  // './fixtures/stack-two.json',
  './fixtures/stack-two.yml',
  // './fixtures/tiny.yml',
  //'./fixtures/stack-three.json',
  // './fixtures/stack-four.json',
  // './fixtures/cdn-cloudformation.json'
).catch(err => {
  console.error('Error:', err)
  process.exit(1)
}); 