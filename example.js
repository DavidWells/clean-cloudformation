const fs = require('fs');
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
  const fileContents = fs.readFileSync('./fixtures/passwordless.json', 'utf8');
  const template = loadData(fileContents);
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
  
  // Save both the cleaned version and the original as YAML
  fs.writeFileSync('outputs/clean-passwordless.yaml', cleanedYaml);
  
  const dirtyYaml = outputDirty(fileContents);
  fs.writeFileSync('outputs/dirty-passwordless.yaml', dirtyYaml);

  // Log the number of lines in the cleaned and dirty files
  const cleanLines = cleanedYaml.split('\n').length;
  const dirtyLines = dirtyYaml.split('\n').length;
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