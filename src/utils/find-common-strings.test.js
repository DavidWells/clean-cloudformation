const { test } = require('uvu')
const assert = require('uvu/assert')
const { findCommonRandomStringsInIds } = require('./find-common-strings')

test('finds 64-char hex hashes', () => {
  const ids = [
    `AssetParametersdcd2c84fda5b77d0d4b17b94d3581fbec6b5bd107cd4f898c2961d5b16e24cabS3Bucket7CA07F13`,
    `AssetParametersdcd2c84fda5b77d0d4b17b94d3581fbec6b5bd107cd4f898c2961d5b16e24cabS3VersionKeyACFCB6F9`,
    `AssetParametersdcd2c84fda5b77d0d4b17b94d3581fbec6b5bd107cd4f898c2961d5b16e24cabArtifactHashD26B5196`
  ]
  const result = findCommonRandomStringsInIds(ids)
  assert.equal(result[0][0], 'dcd2c84fda5b77d0d4b17b94d3581fbec6b5bd107cd4f898c2961d5b16e24cab')
  assert.equal(result[0][1], 3) // Count should be 3
})

test('finds 8-char hex postfixes', () => {
  const ids = [
    'MyFunction7CA07F13',
    'MyOtherFunction7CA07F13',
    'SomeResource55D5887C'
  ]
  const result = findCommonRandomStringsInIds(ids)
  console.log('result', result)
  assert.equal(result[0][0], '7CA07F13')
  assert.equal(result[0][1], 2) // Count should be 2
  assert.equal(result[1][0], '55D5887C')
  assert.equal(result[1][1], 1)
})

test('finds mixed length hex strings', () => {
  const ids = [
    'Resource9f96ad63152a',  // 12-char
    'FunctionB02F3B1B8e03bd86b4d66bb1d95d9f96ad63152a', // 40-char
    'Lambda7AAD8855' // 8-char
  ]
  const result = findCommonRandomStringsInIds(ids)
  console.log('result', result)
  assert.equal(result[0][0], 'B02F3B1B8e03bd86b4d66bb1d95d9f96ad63152a')
  assert.equal(result[1][0], '9f96ad63152a')
  assert.equal(result[2][0], '7AAD8855')
})

test('sorts by length then frequency', () => {
  const ids = [
    'Function7AAD8855',
    'Lambda7AAD8855',
    'Resource9f96ad63152a',
    'Other9f96ad63152a',
    'SomeB02F3B1B'
  ]
  const result = findCommonRandomStringsInIds(ids)
  // Should sort by length (12 > 8) then by count (2 > 1)
  assert.equal(result[0][0], '9f96ad63152a')
  assert.equal(result[0][1], 2)
  assert.equal(result[1][0], '7AAD8855')
  assert.equal(result[1][1], 2)
  assert.equal(result[2][0], 'B02F3B1B')
  assert.equal(result[2][1], 1)
})

test('ignores non-hex strings', () => {
  const ids = [
    'MyFunction12345678', // Not hex
    'Resource7AAD8855',   // Valid hex
    'OtherXYZWABCD'       // Not hex
  ]
  const result = findCommonRandomStringsInIds(ids)
  console.log('result', result)
  assert.equal(result.length, 2)
  assert.equal(result[0][0], '12345678')
  assert.equal(result[1][0], '7AAD8855')
})

test('handles empty input', () => {
  const result = findCommonRandomStringsInIds([])
  assert.equal(result.length, 0)
})

test('Bigger Array with debug', () => {
  const ids = [
    'LambdaRole3A44B857',
    'LambdaRoleDefaultPolicy75625A82',
    'FUUNK75625A82',
    'HandleSendEmailE1602486',
    'SendEmailEndPoint55D5887C',
    'SendEmailEndPointCloudWatchRoleC53822C2',
    'SendEmailEndPointAccount7AAD8855',
    'SendEmailEndPointDeploymentB02F3B1B8e03bd86b4d66bb1d95d9f96ad63152a',
    'SendEmailEndPointDeploymentStageprodAAD8A0FD',
    'SendEmailEndPointsendmail21CF08A1',
    'SendEmailEndPointsendmailPOSTApiPermissionPythonStackSendEmailEndPoint74996537POSTsendmailB5AEFD2F',
    'SendEmailEndPointsendmailPOSTApiPermissionTestPythonStackSendEmailEndPoint74996537POSTsendmail9BD097AB',
    'SendEmailEndPointsendmailPOSTAE8A0D70',
    'SendEmailEndPointsendmailPOSTAE8A'
  ]
  const result = findCommonRandomStringsInIds(ids, true)
  console.log('result', result) 
  // Check the 75625A82 matches since we know it appears twice
  const match75625A82 = result.find(([postfix]) => postfix === '75625A82')
  assert.equal(match75625A82[1], 2) // count should be 2
  assert.equal(match75625A82[2].length, 2) // should have 2 matches
  assert.ok(match75625A82[2].includes('LambdaRoleDefaultPolicy75625A82'), 'LambdaRoleDefaultPolicy75625A82 should be in the matches')
  assert.ok(match75625A82[2].includes('FUUNK75625A82'), 'FUUNK75625A82 should be in the matches')
  assert.ok(match75625A82[3] instanceof RegExp, 'pattern should be present')
})

test('Bigger Array without debug', () => {
  const ids = [
    'LambdaRole3A44B857',
    'LambdaRoleDefaultPolicy75625A82',
    'FUUNK75625A82',
    'HandleSendEmailE1602486',
    'SendEmailEndPoint55D5887C',
    'SendEmailEndPointCloudWatchRoleC53822C2',
    'SendEmailEndPointAccount7AAD8855',
    'SendEmailEndPointDeploymentB02F3B1B8e03bd86b4d66bb1d95d9f96ad63152a',
    'SendEmailEndPointDeploymentStageprodAAD8A0FD',
    'SendEmailEndPointsendmail21CF08A1',
    'SendEmailEndPointsendmailPOSTApiPermissionPythonStackSendEmailEndPoint74996537POSTsendmailB5AEFD2F',
    'SendEmailEndPointsendmailPOSTApiPermissionTestPythonStackSendEmailEndPoint74996537POSTsendmail9BD097AB',
    'SendEmailEndPointsendmailPOSTAE8A0D70',
    'SendEmailEndPointsendmailPOSTAE8A'
  ]
  const result = findCommonRandomStringsInIds(ids)
  
  const match75625A82 = result.find(([postfix]) => postfix === '75625A82')
  assert.equal(match75625A82[1], 2) // count should be 2
  assert.equal(match75625A82[2].length, 2) // should have 2 matches
  assert.equal(match75625A82[3], undefined) // pattern should not be present
})

const wierdIds = [
  'PasswordlessRestApiPasswordlesssigninchallengePOSTApiPermissionTestpasswordlessexamplePasswordlessRestApiPasswordlessF93AE9D6POSTsigninchallengeFE78AD97',
  'AuthServiceApiauthsignupPOSTApiPermissionAuthAppStackAuthServiceApi9287C2C0POSTauthsignupD0F0B2E7'
]

test.only('wierd ids', () => {
  const result = findCommonRandomStringsInIds(wierdIds, true)
  console.log('result', result)
})

test.run() 