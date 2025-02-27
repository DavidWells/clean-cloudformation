const { resolveResources } = require('./get-resources')
const  stringifyJson = require('json-stringify-pretty-compact')
const { getYamlBlock } = require('./get-yaml-block')
const { generateIAMPrompt } = require('./prompts/iam-security')
const { getIntrinsicValue } = require('./get-intrinsic')

function stringifyResource(resource) {
  if (typeof resource === 'string') {
    return resource
  }
  
  // console.log('resource', resource)

  // Skip AWS::NoValue refs
  const ref = getIntrinsicValue(resource, 'Ref')
  if (resource.Ref === 'AWS::NoValue' || ref === 'AWS::NoValue') {
  // if (resource.Ref === 'AWS::NoValue' || resource['Ref::Ref'] === 'AWS::NoValue') {
    return null
  }
  
  // Handle Ref
  if (ref) {
    return `!Ref ${ref}`
  }
  
  // Handle GetAtt
  const getAtt = getIntrinsicValue(resource, 'GetAtt')
  if (getAtt) {
    const attrs = Array.isArray(getAtt) ? getAtt.join('.') : getAtt
    return `!GetAtt ${attrs}`
  }

  // Handle Sub
  const sub = getIntrinsicValue(resource, 'Sub')
  if (sub) {
    return `!Sub ${sub}`
  }

  // Handle Join
  const join = getIntrinsicValue(resource, 'Join')
  if (join) {
    return `!Join ${join}`
  }

  // Handle other cases by JSON stringifying
  return JSON.stringify(resource)
}

async function collectIAMResources(template, yamlString) {
  const iamResources = new Set()
  const inlinePolicies = new Set()
  const managedPolicies = new Set()
  const assumeRolePolicies = new Set()
  const permissionsBoundaries = new Set()
  const resourcePermissions = new Map() // Map of resource ARN to { allow: Set, deny: Set }
  
  function addResourcePermissions(resource, actions, effect) {
    if (!resource || !actions) return
    
    // Handle array of resources
    const resources = Array.isArray(resource) ? resource : [resource]
    const actionsList = Array.isArray(actions) ? actions : [actions]

    resources.forEach(res => {
      // Skip AWS::NoValue refs
      if (res === '!Ref AWS::NoValue' || (res.Ref && res.Ref === 'AWS::NoValue')) {
        return
      }
      
      if (!resourcePermissions.has(res)) {
        resourcePermissions.set(res, { allow: new Set(), deny: new Set() })
      }
      
      const permSet = effect === 'Allow' ? 'allow' : 'deny'
      actionsList.forEach(action => {
        resourcePermissions.get(res)[permSet].add(action)
      })
    })
  }

  function processStatement(statement) {
    // Handle array of statements
    if (Array.isArray(statement)) {
      statement.forEach(s => processStatement(s))
      return
    }

    const effect = statement.Effect || 'Allow' // Default to Allow if not specified
    const actions = statement.Action
    const resources = statement.Resource
    const notResources = statement.NotResource

    if (actions && resources) {
      addResourcePermissions(resources, actions, effect)
    }
    
    // Handle NotResource by noting it specially
    if (actions && notResources) {
      addResourcePermissions(`NOT(${notResources})`, actions, effect)
    }
  }

  function findIAMPolicies(obj, path = [], resourceType = null) {
    if (!obj || typeof obj !== 'object') return

    // If we're at a resource root, get its type
    if (path.length === 2 && path[0] === 'Resources' && obj.Type) {
      resourceType = obj.Type
      const logicalId = path[1]
      
      // Collect IAM resources
      if (resourceType.startsWith('AWS::IAM::')) {
        iamResources.add({
          path: path.join('.'),
          type: resourceType,
          resource: obj,
          yaml: yamlString ? getYamlBlock(yamlString, logicalId) : null
        })
      }
    }

    // Look for IAM-related fields in Properties
    if (path.includes('Properties')) {
      // Process policy documents for permissions
      if (obj.PolicyDocument && obj.PolicyDocument.Statement) {
        processStatement(obj.PolicyDocument.Statement)
      }

      // Inline policies
      if (obj.PolicyDocument) {
        const logicalId = path[1]
        inlinePolicies.add({
          path: path.join('.'),
          resourceType,
          policy: obj.PolicyDocument,
          yaml: yamlString ? getYamlBlock(yamlString, logicalId) : null
        })
      }

      // Managed policy ARNs
      if (obj.ManagedPolicyArns) {
        const logicalId = path[1]
        managedPolicies.add({
          path: path.join('.'),
          resourceType,
          arns: obj.ManagedPolicyArns,
          yaml: yamlString ? getYamlBlock(yamlString, logicalId) : null
        })
      }

      // Assume role policy document
      if (obj.AssumeRolePolicyDocument) {
        const logicalId = path[1]
        assumeRolePolicies.add({
          path: path.join('.'),
          resourceType,
          policy: obj.AssumeRolePolicyDocument,
          yaml: yamlString ? getYamlBlock(yamlString, logicalId) : null
        })
      }

      // Permissions boundary
      if (obj.PermissionsBoundary) {
        const logicalId = path[1]
        permissionsBoundaries.add({
          path: path.join('.'),
          resourceType,
          boundary: obj.PermissionsBoundary,
          yaml: yamlString ? getYamlBlock(yamlString, logicalId) : null
        })
      }

      // Array of policies
      if (Array.isArray(obj.Policies)) {
        const logicalId = path[1]
        obj.Policies.forEach((policy, index) => {
          if (policy && policy.PolicyDocument) {
            inlinePolicies.add({
              path: `${path.join('.')}.Policies[${index}]`,
              resourceType,
              policy: policy.PolicyDocument,
              name: policy.PolicyName,
              yaml: yamlString ? getYamlBlock(yamlString, logicalId) : null
            })
          }
        })
      }
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => findIAMPolicies(item, [...path, index], resourceType))
      return
    }

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object') {
        findIAMPolicies(value, [...path, key], resourceType)
      }
    }
  }

  const { Resources } = resolveResources(template)
  findIAMPolicies(Resources, ['Resources'])

  const foundIAMResources = Array.from(iamResources)
  const foundInlinePolicies = Array.from(inlinePolicies)
  const foundManagedPolicies = Array.from(managedPolicies)
  const foundAssumeRolePolicies = Array.from(assumeRolePolicies)
  const foundPermissionsBoundaries = Array.from(permissionsBoundaries)

  // Convert permissions map to sorted array and filter out null resources
  const permissionsByResource = Array.from(resourcePermissions.entries())
    .map(([resource, { allow, deny }]) => ({
      resource: stringifyResource(resource),
      allow: Array.from(allow).sort(),
      deny: Array.from(deny).sort()
    }))
    .filter(({ resource }) => resource !== null)
    // Consolidate duplicate resources
    .reduce((acc, { resource, allow, deny }) => {
      const existing = acc.find(item => item.resource === resource)
      if (existing) {
        // Merge allow and deny sets
        existing.allow = [...new Set([...existing.allow, ...allow])].sort()
        existing.deny = [...new Set([...existing.deny, ...deny])].sort()
        return acc
      }
      return [...acc, { resource, allow, deny }]
    }, [])
    .sort((a, b) => a.resource.localeCompare(b.resource))

  // process.exit(1)
  return {
    iamResources: foundIAMResources.sort((a, b) => a.path.localeCompare(b.path)),
    inlinePolicies: foundInlinePolicies.sort((a, b) => a.path.localeCompare(b.path)),
    managedPolicies: foundManagedPolicies.sort((a, b) => a.path.localeCompare(b.path)),
    assumeRolePolicies: foundAssumeRolePolicies.sort((a, b) => a.path.localeCompare(b.path)),
    permissionsBoundaries: foundPermissionsBoundaries.sort((a, b) => a.path.localeCompare(b.path)),
    permissionsByResource,
    prompt: generateIAMPrompt(
      foundIAMResources, 
      foundInlinePolicies,
      foundManagedPolicies,
      foundAssumeRolePolicies,
      foundPermissionsBoundaries,
      permissionsByResource,
    )
  }
}

function formatJson(obj) {
  return stringifyJson(obj, { indent: 2, maxLength: 80 })
}

module.exports = {
  collectIAMResources
} 