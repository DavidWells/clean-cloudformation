function generateIAMPrompt(
  iamResources, 
  inlinePolicies, 
  managedPolicies, 
  assumeRolePolicies, 
  permissionsBoundaries,
  permissionsByResource,
) {
  const iamResourcesMarkdown = iamResources.map(({ path, type, resource, yaml }) => {
    return `Resource: \`${path}\`
Type: \`${type}\`
Details:

\`\`\`yaml
${yaml || '# YAML not available'}
\`\`\`
`
  }).join('\n')

  const assumeRolePoliciesMarkdown = assumeRolePolicies.map(({ path, resourceType, yaml }) => {
    return `Location: \`${path}\`
Resource Type: \`${resourceType}\`
Details:

\`\`\`yaml
${yaml || '# YAML not available'}
\`\`\`
`
  }).join('\n')

  const inlinePoliciesMarkdown = inlinePolicies.map(({ path, resourceType, name, yaml }) => {
    return `Location: \`${path}\`${name ? `\nName: \`${name}\`` : ''}
Resource Type: \`${resourceType}\`
Details:

\`\`\`yaml
${yaml || '# YAML not available'}
\`\`\`
`
  }).join('\n')

  const managedPoliciesMarkdown = managedPolicies.map(({ path, resourceType, yaml }) => {
    return `Location: \`${path}\`
Resource Type: \`${resourceType}\`
Details:

\`\`\`yaml
${yaml || '# YAML not available'}
\`\`\`
`
  }).join('\n')

  const permissionsBoundariesMarkdown = permissionsBoundaries.map(({ path, resourceType, yaml }) => {
    return `Location: \`${path}\`
Resource Type: \`${resourceType}\`
Details:

\`\`\`yaml
${yaml || '# YAML not available'}
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
  generateIAMPrompt
} 