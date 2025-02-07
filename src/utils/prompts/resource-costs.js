function generateResourcesPrompt(resourcesByCount) {
  // Filter out custom resources
  const resourceTypesNoCustomResources = Object.entries(resourcesByCount)
    .filter(([type]) => !type.startsWith('Custom::') && !type.startsWith('AWS::CloudFormation::CustomResource'))

  // Flatten and sort all resources by count first, then alphabetically
  const sortedResources = resourceTypesNoCustomResources
    .map(([type, details]) => ({ type, details }))
    .sort((a, b) => {
      // First sort by count descending
      const countDiff = b.details.count - a.details.count
      if (countDiff !== 0) return countDiff
      
      // For equal counts, sort by service name
      const [, serviceA] = a.type.split('::')
      const [, serviceB] = b.type.split('::')
      return serviceA.localeCompare(serviceB)
    })
    .map(({ type, details }) => {
      const word = (details.count === 1) ? 'instance ' : 'instances'
      // Pad single digit numbers with a space for alignment
      const count = details.count < 10 ? ` ${details.count}` : details.count
      return `- ${count} ${word} of \`${type}\``
    })
    .join('\n')

  // If no resources after filtering, return empty prompt
  if (!sortedResources) {
    return 'No standard AWS resources found in template'
  }

  return `
You are an expert AWS Billing consultant.

Below is a list of resources in this CloudFormation stack. Please provide me with their associated costs.

Please output the response with Fixed costs first (For example KMS key costs $1 per month per key), then Variable costs (for example requests to S3 cost $0.01 per 1000 requests).

If any Fixed Monthly Costs are present, please provide the total monthly cost for all Fixed Monthly Costs.

If any Variable Costs are present, please provide some scenarios for how much they might cost. When calculating the scenarios, MAKE SURE to use the correct pricing for the resource (for example, $0.20 per 1M requests for Lambda). Also make sure to include the free tier in your calculations of the scenarios. For any resource that can have on demand billing, assume that is billing mode (For example DynamoDB on demand billing is $0.25 per 1M requests).

At the bottom of your response add the total fixed and estimated variable costs in bold.

Highlight high cost impact resources and suggest optimizations and or alternative approaches.

Here are the resources and their counts:

${sortedResources}
`
}

module.exports = {
  generateResourcesPrompt
} 