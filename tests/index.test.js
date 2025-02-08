const { test } = require('uvu')
const assert = require('uvu/assert')
const { cleanCloudFormation } = require('../src')
const { readFixture, matchSnapshot } = require('./utils')

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

test.run() 