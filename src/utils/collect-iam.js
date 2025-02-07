const { resolveResources, getResourcesEntries } = require('./resolve-resources')
const  stringifyJson = require('json-stringify-pretty-compact')

function stringifyResource(resource) {
  if (typeof resource === 'string') {
    return resource
  }
  
  // console.log('resource', resource)

  // Skip AWS::NoValue refs
  if (resource.Ref === 'AWS::NoValue' || resource['Ref::Ref'] === 'AWS::NoValue') {
    return null
  }
  
  // Handle Ref
  const ref = resource.Ref || resource['Ref::Ref']
  if (ref) {
    return `!Ref ${ref}`
  }
  
  // Handle GetAtt
  const getAtt = resource['Fn::GetAtt'] || resource['Ref::GetAtt']
  if (getAtt) {
    const attrs = Array.isArray(getAtt) ? getAtt.join('.') : getAtt
    return `!GetAtt ${attrs}`
  }

  // Handle Sub
  const sub = resource['Fn::Sub'] || resource['Ref::Sub']
  if (sub) {
    return `!Sub ${sub}`
  }

  // Handle Join
  const join = resource['Fn::Join'] || resource['Ref::Join']
  if (join) {
    return `!Join ${join}`
  }

  // Handle other cases by JSON stringifying
  return JSON.stringify(resource)
}

async function collectIAMResources(template) {
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
      
      // Collect IAM resources
      if (resourceType.startsWith('AWS::IAM::')) {
        iamResources.add({
          path: path.join('.'),
          type: resourceType,
          resource: obj
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
        inlinePolicies.add({
          path: path.join('.'),
          resourceType,
          policy: obj.PolicyDocument
        })
      }

      // Managed policy ARNs
      if (obj.ManagedPolicyArns) {
        managedPolicies.add({
          path: path.join('.'),
          resourceType,
          arns: obj.ManagedPolicyArns
        })
      }

      // Assume role policy document
      if (obj.AssumeRolePolicyDocument) {
        assumeRolePolicies.add({
          path: path.join('.'),
          resourceType,
          policy: obj.AssumeRolePolicyDocument
        })
      }

      // Permissions boundary
      if (obj.PermissionsBoundary) {
        permissionsBoundaries.add({
          path: path.join('.'),
          resourceType,
          boundary: obj.PermissionsBoundary
        })
      }

      // Array of policies
      if (Array.isArray(obj.Policies)) {
        obj.Policies.forEach((policy, index) => {
          if (policy && policy.PolicyDocument) {
            inlinePolicies.add({
              path: `${path.join('.')}.Policies[${index}]`,
              resourceType,
              policy: policy.PolicyDocument,
              name: policy.PolicyName
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
    prompt: generatePrompt(
      foundIAMResources, 
      foundInlinePolicies,
      foundManagedPolicies,
      foundAssumeRolePolicies,
      foundPermissionsBoundaries,
      permissionsByResource
    )
  }
}

function formatJson(obj) {
  return stringifyJson(obj, { indent: 2, maxLength: 80 })
}

function generatePrompt(
  iamResources, 
  inlinePolicies, 
  managedPolicies, 
  assumeRolePolicies, 
  permissionsBoundaries,
  permissionsByResource
) {
  const iamResourcesMarkdown = iamResources.map(({ path, type, resource }) => {
    return `Resource: \`${path}\`
Type: \`${type}\`
Details:

\`\`\`json
${formatJson(resource)}
\`\`\`
`
  }).join('\n')

  const assumeRolePoliciesMarkdown = assumeRolePolicies.map(({ path, resourceType, policy }) => {
    return `Location: \`${path}\`
Resource Type: \`${resourceType}\`
Policy:
\`\`\`json
${formatJson(policy)}
\`\`\`
`
  }).join('\n')

  const inlinePoliciesMarkdown = inlinePolicies.map(({ path, resourceType, policy, name }) => {
    return `Location: \`${path}\`${name ? `\nName: \`${name}\`` : ''}
Resource Type: \`${resourceType}\`
Policy:
\`\`\`json
${formatJson(policy)}
\`\`\`
`
  }).join('\n')

  const managedPoliciesMarkdown = managedPolicies.map(({ path, resourceType, arns }) => {
    return `Location: \`${path}\`
Resource Type: \`${resourceType}\`
ARNs:
\`\`\`json
${formatJson(arns)}
\`\`\`
`
  }).join('\n')

  const permissionsBoundariesMarkdown = permissionsBoundaries.map(({ path, resourceType, boundary }) => {
    return `Location: \`${path}\`
Resource Type: \`${resourceType}\`
Boundary:
\`\`\`json
${formatJson(boundary)}
\`\`\`
`
  }).join('\n')

  const resourcePermissionsMarkdown = permissionsByResource.map(({ resource, allow, deny }) => {
    const sections = []
    
    if (allow.length > 0) {
      sections.push(`Allowed Actions:

\`\`\`
${allow.join('\n')}
\`\`\``)
    }
    
    if (deny.length > 0) {
      sections.push(`Denied Actions:

\`\`\`
${deny.join('\n')}
\`\`\``)
    }

    if (sections.length === 0) return ''

    return `### \`${resource}\`

${sections.join('\n\n')}`
  })
  .filter(Boolean)
  .join('\n\n')

  return `
Please review the following IAM resources and policies for security best practices:

Suggest improvements for:

1. Following least privilege principle
2. Using managed policies where appropriate
3. Avoiding inline policies when possible
4. Using specific resource ARNs instead of wildcards *
5. Adding appropriate condition statements
6. Following AWS security best practices

${iamResources.length ? `## IAM Resources:\n\n${iamResourcesMarkdown}` : ''}
${assumeRolePolicies.length ? `## Trust Relationships (AssumeRolePolicyDocument):\n\n${assumeRolePoliciesMarkdown}` : ''}
${inlinePolicies.length ? `## Inline Policies:\n\n${inlinePoliciesMarkdown}` : ''}
${managedPolicies.length ? `## Managed Policies:\n\n${managedPoliciesMarkdown}` : ''}
${permissionsBoundaries.length ? `## Permissions Boundaries:\n\n${permissionsBoundariesMarkdown}` : ''}
${permissionsByResource.length ? `## Resource Permissions:\n\n${resourcePermissionsMarkdown}` : ''}`
}

module.exports = {
  collectIAMResources
} 