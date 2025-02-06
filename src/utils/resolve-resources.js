

function resolveResources(template) {
  if (template.Resources) {
    return {
      Resources: filterResourcesObject(template.Resources),
      path: 'Resources',
      via: 'cloudformation'
    }
  }

  /* resolve serverless resources */
  if (template.resources && template.resources.Resources) {
    return {
      Resources: filterResourcesObject(template.resources.Resources),
      path: 'resources.Resources',
      via: 'serverless'
    }
  }

  return {
    Resources: undefined,
  }
}

function filterResourcesObject(resources) {
  const filtered = {}
  for (const [key, value] of Object.entries(resources)) {
    if (!key.includes('::')) {
      filtered[key] = value
    }
  }
  return filtered
}

//Fn::ForEach::Route53RecordSet

function getLogicalIds(template) {
  const resources = template.Resources || template.resources.Resources
  if (resources) {
    return Object.keys(filterResourcesObject(resources))
  }
}

function getResourcesEntries(template) {
  const resources = template.Resources || template.resources.Resources
  if (!resources) {
    return []
  }
  // remove Fn::ForEach::Route53RecordSet
  return Object.entries(filterResourcesObject(resources))
}

module.exports = { resolveResources, getLogicalIds, getResourcesEntries }
