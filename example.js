const fs = require('fs').promises
const path = require('path')
const yaml = require('js-yaml')
const { cleanCloudFormation } = require('./index')

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
  
  const cleanedYaml = await cleanCloudFormation(fileContents, {
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
    fs.writeFile(`outputs/${baseName}-clean.yml`, cleanedYaml),
    fs.writeFile(`outputs/${baseName}-dirty.yml`, outputDirty(fileContents))
  ])

  // Log the number of lines in the cleaned and dirty files
  const cleanLines = cleanedYaml.split('\n').length
  const dirtyLines = outputDirty(fileContents).split('\n').length
  console.log(`Clean lines: ${cleanLines}`)
  console.log(`Dirty lines: ${dirtyLines}`)
  // Log savings
  const savings = ((dirtyLines - cleanLines) / dirtyLines) * 100
  console.log(`Savings: ${savings.toFixed(2)}%`)
  console.log(`Transformation complete! Output written to ${baseName}-clean.yml`)
}

example(
  // './fixtures/stack-one.json',
  // './fixtures/stack-two.json',
  //'./fixtures/stack-three.json',
  './fixtures/stack-four.json',
  // './fixtures/cdn-cloudformation.json'
).catch(err => {
  console.error('Error:', err)
  process.exit(1)
}); 