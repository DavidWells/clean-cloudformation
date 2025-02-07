const { resolveResources } = require('./get-resources')
const { generateResourcesPrompt } = require('./prompts/resource-costs')
const { deepLog } = require('./logger')
const { getIntrinsicValue } = require('./get-intrinsic')

function getResourcesInfo(template) {
  const resourcesByCount = {}
  let totalResources = 0
  const lambdaFunctions = []
  const logGroups = []
  const lambdaRoles = [] // Array to store Lambda execution roles

  function checkPolicyForBasicExecution(policy) {
    if (typeof policy === 'string') {
      return policy.includes('service-role/AWSLambdaBasicExecutionRole')
    }
    
    // Handle Join format
    const joinValue = getIntrinsicValue(policy, 'Join')
    if (joinValue) {
      const joinParts = joinValue[1]
      if (Array.isArray(joinParts)) {
        return joinParts.some(part => 
          typeof part === 'string' && part.includes('service-role/AWSLambdaBasicExecutionRole')
        )
      }
    }

    // Handle Sub format
    const subValue = getIntrinsicValue(policy, 'Sub')
    if (subValue) {
      return subValue.includes('service-role/AWSLambdaBasicExecutionRole')
    }
    
    return false
  }

  function getLambdaFromLogGroupName(logGroupName) {
    if (typeof logGroupName === 'string') {
      return logGroupName.startsWith('/aws/lambda/') ? 
        logGroupName.slice('/aws/lambda/'.length) : 
        null
    }

    // Handle Fn::Join format
    const joinValue = getIntrinsicValue(logGroupName, 'Join')
    if (joinValue) {
      const [separator, parts] = joinValue
      if (parts[0] === '/aws/lambda/') {
        return parts[1] // Return the lambda function name/reference
      }
    }

    // Handle Fn::Sub format
    const subValue = getIntrinsicValue(logGroupName, 'Sub')
    if (subValue && typeof subValue === 'string') {
      return subValue.startsWith('/aws/lambda/') ?
        subValue.slice('/aws/lambda/'.length) :
        null
    }

    return null
  }

  const { Resources } = resolveResources(template)

  if (!Resources) {
    return { 
      resourcesByCount,
      totalResources,
      resourcesPrompt: 'No resources found in template',
      lambdaFunctions,
      logGroups,
      lambdaRoles
    }
  }

  // First pass: collect log groups and Lambda execution roles
  Object.entries(Resources).forEach(([logicalId, resource]) => {
    console.log('resource', resource)
    // Collect Log Groups
    if (resource.Type === 'AWS::Logs::LogGroup') {
      const logGroupName = resource.Properties?.LogGroupName
      logGroups.push({
        logicalId,
        resource,
        lambdaFunction: getLambdaFromLogGroupName(logGroupName)
      })
    }

    // Collect Lambda execution roles
    if (resource.Type === 'AWS::IAM::Role') {
      const assumeRolePolicy = resource.Properties?.AssumeRolePolicyDocument
      const isLambdaRole = assumeRolePolicy?.Statement?.some(statement => 
        statement.Principal?.Service === 'lambda.amazonaws.com'
      )

      if (isLambdaRole) {
        const managedPolicies = resource.Properties?.ManagedPolicyArns || []
        const hasBasicExecutionRole = managedPolicies.some(policy => {
          // console.log('policy', policy)
          deepLog(policy)
          return checkPolicyForBasicExecution(policy)
        })

        lambdaRoles.push({
          logicalId,
          resource,
          hasBasicExecutionRole
        })
      }
    }
  })

  /*
  console.log('logGroups', logGroups)
  console.log('lambdaRoles', lambdaRoles)
  process.exit(1)
  /** */

  // Second pass: count resources and collect Lambda functions
  Object.entries(Resources).forEach(([logicalId, resource]) => {
    const type = resource.Type
    if (!resourcesByCount[type]) {
      resourcesByCount[type] = {
        count: 0,
        logicalIds: []
      }
    }
    resourcesByCount[type].count++
    resourcesByCount[type].logicalIds.push(logicalId)
    totalResources++

    // Collect Lambda function details
    if (type === 'AWS::Lambda::Function') {
      // Find associated log group
      const associatedLogGroup = logGroups.find(lg => 
        lg.lambdaFunction === logicalId || 
        lg.lambdaFunction === resource.Properties?.FunctionName
      )

      // Find associated role
      const roleProperty = resource.Properties?.Role
      const roleLogicalId = roleProperty?.['Ref'] // For direct Ref to role
      const associatedRole = roleLogicalId ? 
        lambdaRoles.find(role => role.logicalId === roleLogicalId) :
        null

      lambdaFunctions.push({
        logicalId,
        resource,
        logGroup: associatedLogGroup,
        role: associatedRole
      })
    }
  })

  // Sort by count descending
  const sortedResources = Object.entries(resourcesByCount)
    .sort(([, a], [, b]) => b.count - a.count)
    .reduce((acc, [key, value]) => {
      acc[key] = value
      return acc
    }, {})

  const resourcesPrompt = generateResourcesPrompt(sortedResources)

  return {
    totalResources,
    lambdaFunctions: lambdaFunctions.sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
    logGroups: logGroups.sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
    lambdaRoles: lambdaRoles.sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
    resourcesByCount: sortedResources,
    resourcesPrompt,
  }
}

module.exports = {
  getResourcesInfo
} 