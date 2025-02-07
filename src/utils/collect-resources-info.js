const { resolveResources } = require('./get-resources')
const { generateResourcesPrompt } = require('./prompts/resource-costs')

function getResourcesInfo(template) {
  const resourcesByCount = {}
  let totalResources = 0
  const lambdaFunctions = [] // Array to store Lambda function details

  const { Resources } = resolveResources(template)

  if (!Resources) {
    return { 
      resourcesByCount,
      totalResources,
      resourcesPrompt: 'No resources found in template',
      lambdaFunctions
    }
  }

  // Count resources by type and collect Lambda functions
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
      lambdaFunctions.push({
        logicalId,
        resource
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

  // console.log('resourcesPrompt', sortedResources)
  // process.exit(1)
  return {
    totalResources,
    lambdaFunctions: lambdaFunctions.sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
    resourcesByCount: sortedResources,
    resourcesPrompt,
  }
}

module.exports = {
  getResourcesInfo
} 