const yaml = require('js-yaml')

function getCfnSchema() {
  // Define CloudFormation tags schema
  const cfnTags = [
    new yaml.Type('!Ref', { kind: 'scalar' }),
    new yaml.Type('!Sub', { kind: 'scalar' }),
    new yaml.Type('!GetAtt', { kind: 'scalar' }),
    new yaml.Type('!Join', { kind: 'sequence' }),
    new yaml.Type('!Select', { kind: 'sequence' }),
    new yaml.Type('!Split', { kind: 'sequence' }),
    new yaml.Type('!FindInMap', { kind: 'sequence' }),
    new yaml.Type('!If', { kind: 'sequence' }),
    new yaml.Type('!Not', { kind: 'sequence' }),
    new yaml.Type('!Equals', { kind: 'sequence' }),
    new yaml.Type('!And', { kind: 'sequence' }),
    new yaml.Type('!Or', { kind: 'sequence' }),
    new yaml.Type('!Base64', { kind: 'scalar' }),
    new yaml.Type('!Cidr', { kind: 'sequence' }),
    new yaml.Type('!Transform', { kind: 'mapping' }),
    new yaml.Type('!ImportValue', { kind: 'scalar' }),
    new yaml.Type('!GetAZs', { kind: 'scalar' }),
    new yaml.Type('!Condition', { kind: 'scalar' })
  ]

  // Create custom schema with CloudFormation tags
  return yaml.DEFAULT_SCHEMA.extend(cfnTags)
}

module.exports = {
  getCfnSchema
} 