const yaml = require('js-yaml')

function getCfnSchema() {
  // Define CloudFormation tags schema
  const cfnTags = [
    new yaml.Type('!Ref', {
      kind: 'scalar',
      construct: function(data) {
        return { 'Ref': data }
      }
    }),
    new yaml.Type('!Sub', {
      kind: 'scalar',
      construct: function(data) {
        return { 'Fn::Sub': data }
      }
    }),
    new yaml.Type('!GetAtt', {
      kind: 'scalar',
      construct: function(data) {
        return { 'Fn::GetAtt': data.split('.') }
      }
    }),
    new yaml.Type('!Join', {
      kind: 'sequence',
      construct: function(data) {
        return { 'Fn::Join': data }
      }
    }),
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

  // Create a custom type for IAM Policy Version
  // const policyVersionType = new yaml.Type('tag:yaml.org,2002:str', {
  //   kind: 'scalar',
  //   resolve: function(data) {
  //     console.log('data', data)
  //     // Check if this looks like a policy version
  //     if (typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
  //       return true
  //     }
  //     return false
  //   },
  //   construct: function(data) {
  //     return data
  //   }
  // })

  // Create custom schema with CloudFormation tags and policy version handling
  return yaml.DEFAULT_SCHEMA.extend([
    ...cfnTags, 
    // policyVersionType
  ])
}

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
    schema: getCfnSchema() // Add schema here
  })
}

module.exports = {
  getCfnSchema,
  dumpYaml
} 