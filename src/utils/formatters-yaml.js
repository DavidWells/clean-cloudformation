

function formatYaml(yamlContent = '') {
    // Fix array indentation
  yamlContent = yamlContent.replace(/^(\s+)[^-\s].*:\n\1-\s/gm, '$1$&  ')

  // Apply YAML formatting
  yamlContent = yamlContent.replace(/Ref::/g, '!')
  yamlContent = yamlContent.replace(/!(Ref|GetAtt|Join|Sub|Select|Split|FindInMap|If|Not|Equals|And|Or):/g, '!$1')
  
  /* Fold DependsOn arrays if 2 or less into a single line */
  yamlContent = yamlContent.replace(
    /^(\s+)DependsOn:\n(?:\1[\s-]+.+?\n)+/gm,
    (match) => {
      const values = match
        .split('\n')
        .filter(line => line.includes('-'))
        .map(line => line.substring(line.indexOf('-') + 1).trim())
        .filter(Boolean)

      // Only transform if there are 1 or 2 values
      if (values.length > 2) {
        return match
      }

      const indent = match.match(/^\s+/)[0]
      return `${indent}DependsOn: [ ${values.join(', ')} ]\n`
    }
  )

  yamlContent = insertBlankLines(yamlContent)
  yamlContent = yamlContent.replace(/(^Resources:\n)\n/, '$1')
  yamlContent = yamlContent.replace(/^(\s+)!(Equals)\n\1-\s+(.+?)\n\1-\s+(.+?)$/gm, '$1!$2 [ $3, $4 ]')
  yamlContent = yamlContent.replace(
    /^(\s+)-\s+!Equals\n\1\s+-\s+(.+?)\n\1\s+-\s+(.+?)$/gm,
    '$1- !Equals [ $2, $3 ]'
  )
  yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!(?:Sub|Ref|GetAtt)\s.+)$/gm, '$1$2: $3')
  yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!Equals\s+\[.+?\])$/gm, '$1$2: $3')
  
  /* Fold AllowedValues arrays into a single line */
  yamlContent = yamlContent.replace(
    /^(\s+)AllowedValues:\n(?:\1\s*-\s+(.+?)(?:\n|$))+/gm,
    (match) => {
      const values = match
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => {
          const value = line.substring(line.indexOf('-') + 1).trim()
          // If value is already quoted, keep it as is, otherwise add quotes
          return value.match(/^["'].*["']$/) ? value : `"${value}"`
        })
        .filter(Boolean)

      const indent = match.match(/^\s+/)[0]
      return `${indent}AllowedValues: [${values.join(', ')}]\n`
    }
  )

  yamlContent = yamlContent.replace(/\n\n\n+/g, '\n\n')

  return yamlContent
}

function insertBlankLines(content) {
  const twoSpaces = '  '
  
  // Add blank lines before top-level keys
  content = content.replace(
    /^(Description|Metadata|Rules|Mappings|Parameters|Conditions|Resources|Outputs):/gm,
    '\n$1:'
  )
  
  // Add blank lines before resources (existing functionality)
  content = content.replace(
    /((?<!^\s*$\n)^  [A-Za-z0-9_-]+:\s*\n\s+Type:\s+(?:AWS|Custom|[A-Za-z0-9]+)::[A-Za-z0-9:]+)/gm,
    '\n$1'
  )

  return content
}

module.exports = {
  formatYaml
}