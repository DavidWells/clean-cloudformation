const { test } = require('uvu')
const assert = require('uvu/assert')
const { cleanCloudFormation } = require('../src')
const { readFixture, matchSnapshot } = require('./utils')
const { dumpYaml } = require('../src/utils/yaml')

test('cleanCloudFormation - stack-one.json', async () => {
  const input = await readFixture('stack-one.json')
  const { yaml } = await cleanCloudFormation(input)
  await matchSnapshot('stack-one', yaml)
})

test('cleanCloudFormation - stack-one.json with replaceLogicalIds', async () => {
  const input = await readFixture('stack-one.json')
  const { yaml } = await cleanCloudFormation(input, {
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
  await matchSnapshot('stack-one-with-replace-ids', yaml)
})

test('cleanCloudFormation - stack-one.yaml with replaceLogicalIds', async () => {
  const input = await readFixture('stack-one-yaml.yml')
  const { yaml } = await cleanCloudFormation(input, {
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
  await matchSnapshot('stack-one-with-replace-ids-yaml', yaml)
})

test('cleanCloudFormation - stack-two.json', async () => {
  const input = await readFixture('stack-two.json')
  const { yaml } = await cleanCloudFormation(input)
  await matchSnapshot('stack-two', yaml)
})

test('cleanCloudFormation - serverless.yml', async () => {
  const input = await readFixture('serverless.yml')
  const { yaml } = await cleanCloudFormation(input)
  await matchSnapshot('serverless', yaml)
})

test('cleanCloudFormation - remote template', async () => {
  const url = 'https://raw.githubusercontent.com/panacloud-modern-global-apps/full-stack-serverless-cdk/798c98300b89cfb5eac6004cd348fa60d05f813b/step16_simple_email_service/python/sending_email_using%20_ses_lambdaa/cdk.out/PythonStack.template.json'
  const { yaml } = await cleanCloudFormation(url)
  // console.log('yaml', yaml) 
  // process.exit(1)
  await matchSnapshot('sending_email_using_ses_lambdaa', yaml)
})


test('cleanCloudFormation - SohWithEventBridge', async () => {
  const url = 'https://raw.githubusercontent.com/kknd4eva/SohWithEventBridge/refs/heads/master/SohWithEventBridge/serverless.yaml'
  const { yaml } = await cleanCloudFormation(url)
  // console.log('yaml', yaml)
  // process.exit(1)
  await matchSnapshot('SohWithEventBridge', yaml)
})

test('cleanCloudFormation - AuthAppStack', async () => {
  const input = await readFixture('AuthStack.json')
  const originalTemplate = JSON.parse(input)
  const { yaml, json } = await cleanCloudFormation(input)
  
  // Verify template structure is preserved
  const counts = {
    original: {
      Parameters: Object.keys(originalTemplate.Parameters || {}).length,
      Resources: Object.keys(originalTemplate.Resources || {}).length,
      Outputs: Object.keys(originalTemplate.Outputs || {}).length
    },
    transformed: {
      Parameters: Object.keys(json.Parameters || {}).length,
      Resources: Object.keys(json.Resources || {}).length,
      Outputs: Object.keys(json.Outputs || {}).length
    }
  }

  console.log('Template component counts:', counts)

  // Compare sections and find differences
  const sections = ['Parameters', 'Resources', 'Outputs']
  sections.forEach(section => {
    const originalKeys = new Set(Object.keys(originalTemplate[section] || {}))
    const transformedKeys = new Set(Object.keys(json[section] || {}))
    
    // Find missing and added keys
    const missing = [...originalKeys].filter(x => !transformedKeys.has(x))
    const added = [...transformedKeys].filter(x => !originalKeys.has(x))
    
    if (missing.length > 0 || added.length > 0) {
      console.log(`\n${section} differences:`)
      if (missing.length > 0) {
        console.log('Missing:', missing)
        missing.forEach(key => {
          console.log(`xOriginal ${key}:`)
          //console.log(originalTemplate[section][key])
        })
      }
      if (added.length > 0) {
        // console.log('Added:', added)
        // added.forEach(key => {
        //   console.log(`Added ${key}:`, json[section][key])
        // })
      }
    }
  })
  // process.exit(1)

  // Assert counts match
  assert.equal(
    counts.transformed.Parameters, 
    counts.original.Parameters - 1, 
    'Parameters count should match'
  )
  assert.equal(
    counts.transformed.Resources, 
    counts.original.Resources - 1, 
    'Resources count should match'
  )
  assert.equal(
    counts.transformed.Outputs, 
    counts.original.Outputs, 
    'Outputs count should match'
  )

  await matchSnapshot('AuthStack', yaml)
})

test.run() 