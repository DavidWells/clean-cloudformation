function generateNamePrompt(results) {
  const prompt = `
Please rename the following CloudFormation resources to be more descriptive and easier to understand.

Naming Rules:

- Resource names must be unique within the template.
- Use !Sub and AWS::StackName to create unique names. For example: !Sub "\${AWS::StackName}-[resource-name]"
- Resource names must follow AWS rules and naming conventions for the given CloudFormation resourceType.
- Resource names must follow the rules defined in \`description\` if they are specified.
- Any rules found in \`description\` are highest priority, use them over \`pattern\`, \`minLength\`, and \`maxLength\`.

Update the below resources to be more descriptive and easier to understand, following the rules above.

${results.map(({ path, value, resourceType, validation }) => {
  // Format description with proper indentation and wrapping
  const description = validation.description
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0) // Remove empty lines
    .map(line => {
      // Wrap text at 120 chars with proper indentation
      const words = line.split(' ')
      const lines = []
      let currentLine = ''
      
      words.forEach(word => {
        if ((currentLine + ' ' + word).length > 160) {
          lines.push(currentLine)
          currentLine = word
        } else {
          currentLine = currentLine ? currentLine + ' ' + word : word
        }
      })
      if (currentLine) lines.push(currentLine)
      
      return lines.join('\n      ')
    })
    .join('\n      ')

  return `- Value: ${value}
  - location: ${path}
  - resourceType: ${resourceType}
  - description: ${description}
  - pattern: ${validation.pattern}
  - minLength: ${validation.minLength}
  - maxLength: ${validation.maxLength}
`}).join('\n')}
`     
  return prompt
}

module.exports = {
  generateNamePrompt
} 