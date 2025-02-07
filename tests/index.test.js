const { test } = require('uvu')
const assert = require('uvu/assert')
const { cleanCloudFormation } = require('../src')
const fs = require('fs').promises
const path = require('path')

// Helper to read fixture files
async function readFixture(name) {
  const fixturePath = path.join(__dirname, 'fixtures', name)
  return fs.readFile(fixturePath, 'utf8')
}

// Helper to create snapshot
async function matchSnapshot(name, content) {
  const snapshotDir = path.join(__dirname, '__snapshots__')
  const snapshotPath = path.join(snapshotDir, `${name}.snap`)

  // Ensure snapshot directory exists
  await fs.mkdir(snapshotDir, { recursive: true })

  try {
    const existing = await fs.readFile(snapshotPath, 'utf8')
    assert.fixture(content, existing)
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Create new snapshot if it doesn't exist
      await fs.writeFile(snapshotPath, content)
      console.log(`Created new snapshot: ${name}`)
    } else {
      throw err
    }
  }
}

test('cleanCloudFormation - stack-one.json', async () => {
  const input = await readFixture('stack-one.json')
  const { yaml } = await cleanCloudFormation(input)
  await matchSnapshot('stack-one', yaml)
})

test('cleanCloudFormation - stack-two.json', async () => {
  const input = await readFixture('stack-two.json')
  const { yaml } = await cleanCloudFormation(input)
  await matchSnapshot('stack-two', yaml)
})

// test('cleanCloudFormation - serverless.yml', async () => {
//   const input = await readFixture('serverless.yml')
//   const { yaml } = await cleanCloudFormation(input)
//   await matchSnapshot('serverless', yaml)
// })

test('cleanCloudFormation - remote template', async () => {
  const url = 'https://raw.githubusercontent.com/aws-samples/aws-cloudformation-templates/master/aws/services/CloudFront/cloudfront-security-headers.yaml'
  const { yaml } = await cleanCloudFormation(url)
  await matchSnapshot('cloudfront-security-headers', yaml)
})

test.run() 