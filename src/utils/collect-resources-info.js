const { resolveResources } = require('./resolve-resources')
const { generateResourcesPrompt } = require('./prompts/resource-costs')

function getResourceCounts(template) {
  const resourcesByCount = {}
  let totalResources = 0

  const { Resources } = resolveResources(template)

  if (!Resources) {
    return { 
      resourcesByCount,
      totalResources,
      resourcesPrompt: 'No resources found in template'
    }
  }

  // Count resources by type
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
    resourcesByCount: sortedResources,
    totalResources,
    resourcesPrompt
  }
}

module.exports = {
  getResourceCounts
} 