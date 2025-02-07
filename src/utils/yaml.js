const yaml = require('js-yaml')
const { getCfnYamlSchema } = require('./schemas')

function dumpYaml(template) {
  return yaml.dump(template, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    noArrayIndent: false,
    flowStyle: false,
    styles: {
      '!!null': 'empty',
      '!!str': 'plain'
    },
    quotingType: '"',  // Use double quotes instead of single quotes
    forceQuotes: false, // Only quote when necessary
    schema: getCfnYamlSchema() // Add schema here
  })
}

module.exports = {
  getCfnYamlSchema,
  dumpYaml
} 