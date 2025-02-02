const fs = require('fs').promises;
const yaml = require('js-yaml');
const { cleanCloudFormation, loadData } = require('./index');

function outputDirty(fileContents) {
  return yaml.dump(yaml.load(fileContents), {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    noArrayIndent: true,
    flowStyle: false,
  });
}

async function example() {
  // Read input file
  const fileContents = await fs.readFile('./fixtures/passwordless.json', 'utf8');
  const template = await loadData(fileContents);
  
  const cleanedYaml = await cleanCloudFormation(template, {
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
  await Promise.all([
    fs.writeFile('outputs/clean-passwordless.yaml', cleanedYaml),
    fs.writeFile('outputs/dirty-passwordless.yaml', outputDirty(fileContents))
  ]);

  // Log the number of lines in the cleaned and dirty files
  const cleanLines = cleanedYaml.split('\n').length;
  const dirtyLines = outputDirty(fileContents).split('\n').length;
  console.log(`Clean lines: ${cleanLines}`);
  console.log(`Dirty lines: ${dirtyLines}`);
  // Log savings
  const savings = ((dirtyLines - cleanLines) / dirtyLines) * 100;
  console.log(`Savings: ${savings.toFixed(2)}%`);
  console.log('Transformation complete! Output written to clean-passwordless.yaml');
}

example().catch(err => {
  console.error('Error:', err);
  process.exit(1);
}); 