const { resolveResources } = require('./get-resources')
const { generateResourcesPrompt } = require('./prompts/resource-costs')
const { deepLog } = require('./logger')
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
    
    // Handle Fn::Join format
    /*
      {
      'Fn::Join': [ '',
        [
          'arn:',
          [Object],
          ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
        ]
      ]
    }
    */
    if (policy['Fn::Join']) {
      const joinParts = policy['Fn::Join'][1]
      if (Array.isArray(joinParts)) {
        return joinParts.some(part => 
          typeof part === 'string' && part.includes('service-role/AWSLambdaBasicExecutionRole')
        )
      }
    }

    /* Handle Ref::Sub format
    {
      'Ref::Sub': 'arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
    }
    */
    if (policy['Ref::Sub']) {
      return policy['Ref::Sub'].includes('service-role/AWSLambdaBasicExecutionRole')
    }
    
    return false
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
    // Collect Log Groups
    if (resource.Type === 'AWS::Logs::LogGroup') {
      logGroups.push({
        logicalId,
        resource,
        // Track which Lambda function this log group might be associated with
        lambdaFunction: resource.Properties?.LogGroupName?.['Fn::Join']?.[1]?.[0] === '/aws/lambda/' ? 
          resource.Properties.LogGroupName['Fn::Join'][1][1] : 
          resource.Properties?.LogGroupName?.startsWith('/aws/lambda/') ?
            resource.Properties.LogGroupName.slice('/aws/lambda/'.length) :
            null
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

  console.log('logGroups', logGroups)
  console.log('lambdaRoles', lambdaRoles)
  process.exit(1)

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