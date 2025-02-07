const { test } = require('uvu')
const assert = require('uvu/assert')
const { getYamlBlock } = require('./yaml-blocks')

test('getYamlBlock - extracts simple resource block', () => {
  const yaml = `
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: test-bucket
  OtherResource:
    Type: AWS::SNS::Topic`

  const result = getYamlBlock(yaml, 'MyBucket')
  assert.equal(result.trim(), 
    'MyBucket:\n  Type: AWS::S3::Bucket\n  Properties:\n    BucketName: test-bucket'
  )
})

test('getYamlBlock - handles nested properties', () => {
  const yaml = `
Resources:
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Code:
        ZipFile: |
          exports.handler = async () => {
            return { statusCode: 200 }
          }
      Runtime: nodejs18.x
  OtherResource:
    Type: AWS::SNS::Topic`

  const result = getYamlBlock(yaml, 'MyFunction')
  assert.equal(result.trim(), 
    'MyFunction:\n  Type: AWS::Lambda::Function\n  Properties:\n    Code:\n      ZipFile: |\n        exports.handler = async () => {\n          return { statusCode: 200 }\n        }\n    Runtime: nodejs18.x'
  )
})

test('getYamlBlock - handles resource not found', () => {
  const yaml = `
Resources:
  MyBucket:
    Type: AWS::S3::Bucket`

  const result = getYamlBlock(yaml, 'NonExistentResource')
  assert.equal(result.trim(), '')
})

test('getYamlBlock - preserves empty lines within block', () => {
  const yaml = `
Resources:
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler

      Runtime: nodejs18.x

      Timeout: 30
  OtherResource:
    Type: AWS::SNS::Topic`

  const result = getYamlBlock(yaml, 'MyFunction', {
    // removeIndent: false
  })

const expected =
`MyFunction:
  Type: AWS::Lambda::Function
  Properties:
    Handler: index.handler

    Runtime: nodejs18.x

    Timeout: 30`

  assert.equal(result, expected)
})

test('getYamlBlock - caches results', () => {
  const yaml = `
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: test-bucket`

  // First call should cache
  const result1 = getYamlBlock(yaml, 'MyBucket')
  // Second call should use cache
  const result2 = getYamlBlock(yaml, 'MyBucket')

  assert.equal(result1, result2)
  assert.equal(result1.trim(),
    'MyBucket:\n  Type: AWS::S3::Bucket\n  Properties:\n    BucketName: test-bucket'
  )
})

test('getYamlBlock - handles malformed YAML gracefully', () => {
  const yaml = `
Resources:
  MyBucket:
  Invalid:Indentation:Here
    Type: AWS::S3::Bucket`

  const result = getYamlBlock(yaml, 'MyBucket')
  assert.equal(result.trim(), 'MyBucket:')
})

test('clearYamlBlockCache - clears the cache', () => {
  const yaml = `
Resources:
  MyBucket:
    Type: AWS::S3::Bucket`

  // First call should cache
  const result1 = getYamlBlock(yaml, 'MyBucket')
  
  // Clear cache
  const { clearYamlBlockCache } = require('./yaml-blocks')
  clearYamlBlockCache()
  
  // Second call should recompute
  const result2 = getYamlBlock(yaml, 'MyBucket')

  assert.equal(result1, result2)
  assert.equal(result1.trim(), 'MyBucket:\n  Type: AWS::S3::Bucket')
})

test('getYamlBlock - preserves original indentation when removeIndent=false', () => {
  const yaml = `
Resources:
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler

      Runtime: nodejs18.x

      Timeout: 30
  OtherResource:
    Type: AWS::SNS::Topic`

  const result = getYamlBlock(yaml, 'MyFunction', { removeIndent: false })

  assert.equal(result,
`  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler

      Runtime: nodejs18.x

      Timeout: 30`
  )
})

test('getYamlBlock - handles indented Resources section', () => {
  const yaml = `
  Resources:
    MyBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: test-bucket
    OtherResource:
      Type: AWS::SNS::Topic`

  const result = getYamlBlock(yaml, 'MyBucket', { 
    keyIndentation: 2 
  })
  assert.equal(result.trim(), 
    'MyBucket:\n  Type: AWS::S3::Bucket\n  Properties:\n    BucketName: test-bucket'
  )
})

test('getYamlBlock - handles deeply indented Resources with preserved indentation', () => {
  const yaml = `
    Resources:
      MyBucket:
        Type: AWS::S3::Bucket
        Properties:
          BucketName: test-bucket
      OtherResource:
        Type: AWS::SNS::Topic`

  const result = getYamlBlock(yaml, 'MyBucket', { 
    keyIndentation: 4,
    removeIndent: false 
  })
  // console.log(result)
  assert.equal(result, 
`      MyBucket:
        Type: AWS::S3::Bucket
        Properties:
          BucketName: test-bucket`
  )
})

test('getYamlBlock - can remove empty lines', () => {
  const yaml = `
Resources:
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler

      Runtime: nodejs18.x

      Timeout: 30
  OtherResource:
    Type: AWS::SNS::Topic`

  const result = getYamlBlock(yaml, 'MyFunction', {
    preserveEmptyLines: false
  })

  const expected =
`MyFunction:
  Type: AWS::Lambda::Function
  Properties:
    Handler: index.handler
    Runtime: nodejs18.x
    Timeout: 30`

  assert.equal(result, expected)
})

test('getYamlBlock - preserves empty lines by default', () => {
  const yaml = `
Resources:
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler

      Runtime: nodejs18.x

      Timeout: 30
  OtherResource:
    Type: AWS::SNS::Topic`

  const result = getYamlBlock(yaml, 'MyFunction')

  const expected =
`MyFunction:
  Type: AWS::Lambda::Function
  Properties:
    Handler: index.handler

    Runtime: nodejs18.x

    Timeout: 30`

  assert.equal(result, expected)
})

test('getYamlBlock - handles complex YAML with multiple resources', () => {
  const yaml = `
Resources:
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler
      Code:
        ZipFile: |
          exports.handler = async (event) => {
            console.log('Event:', JSON.stringify(event))
            
            const response = {
              statusCode: 200,
              body: JSON.stringify({ message: 'Success!' })
            }
            
            return response
          }
      Environment:
        Variables:
          BUCKET_NAME: !Ref MyBucket
          TABLE_NAME: !Ref MyTable
      Tags:
        - Key: Environment
          Value: Production
        - Key: Service
          Value: MyApp

  MyBucket:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    Properties:
      BucketName: !Sub \${AWS::StackName}-artifacts
      VersioningConfiguration:
        Status: Enabled
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256

  MyTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub \${AWS::StackName}-data
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: id
          AttributeType: S
      KeySchema:
        - AttributeName: id
          KeyType: HASH
      StreamSpecification:
        StreamViewType: NEW_AND_OLD_IMAGES`

  const result = getYamlBlock(yaml, 'MyBucket')

  const expected =
`MyBucket:
  Type: AWS::S3::Bucket
  DeletionPolicy: Retain
  Properties:
    BucketName: !Sub \${AWS::StackName}-artifacts
    VersioningConfiguration:
      Status: Enabled
    BucketEncryption:
      ServerSideEncryptionConfiguration:
        - ServerSideEncryptionByDefault:
            SSEAlgorithm: AES256`

  assert.equal(result, expected, 'AES256 1')

  // Test with removeIndent: false
  const resultWithIndent = getYamlBlock(yaml, 'MyBucket', { removeIndent: false })
  const expectedWithIndent =
`  MyBucket:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    Properties:
      BucketName: !Sub \${AWS::StackName}-artifacts
      VersioningConfiguration:
        Status: Enabled
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256`

  assert.equal(resultWithIndent, expectedWithIndent, 'AES256 2')
})

test('getYamlBlock - removes trailing empty lines', () => {
  const yaml = `
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: test-bucket

  OtherResource:
    Type: AWS::SNS::Topic`

  const result = getYamlBlock(yaml, 'MyBucket')
  const expected =
`MyBucket:
  Type: AWS::S3::Bucket
  Properties:
    BucketName: test-bucket`

  assert.equal(result, expected)
})

test.run() 