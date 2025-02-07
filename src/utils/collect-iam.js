const { resolveResources, getResourcesEntries } = require('./resolve-resources')
const  stringifyJson = require('json-stringify-pretty-compact')

async function collectIAMResources(template) {
  const iamResources = new Set()
  const inlinePolicies = new Set()
  const managedPolicies = new Set()
  const assumeRolePolicies = new Set()
  const permissionsBoundaries = new Set()
  
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

  return {
    iamResources: foundIAMResources.sort((a, b) => a.path.localeCompare(b.path)),
    inlinePolicies: foundInlinePolicies.sort((a, b) => a.path.localeCompare(b.path)),
    managedPolicies: foundManagedPolicies.sort((a, b) => a.path.localeCompare(b.path)),
    assumeRolePolicies: foundAssumeRolePolicies.sort((a, b) => a.path.localeCompare(b.path)),
    permissionsBoundaries: foundPermissionsBoundaries.sort((a, b) => a.path.localeCompare(b.path)),
    prompt: generatePrompt(
      foundIAMResources, 
      foundInlinePolicies,
      foundManagedPolicies,
      foundAssumeRolePolicies,
      foundPermissionsBoundaries
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
  permissionsBoundaries
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

${permissionsBoundaries.length ? `## Permissions Boundaries:\n\n${permissionsBoundariesMarkdown}` : ''}`
}

module.exports = {
  collectIAMResources
} 