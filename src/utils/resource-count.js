const { resolveResources } = require('./resolve-resources')

function getResourceCounts(template) {
  const resourceTypeCounts = new Map();
  let resourcesPrompt;
  let resourcesByCount;

  const { Resources } = resolveResources(template)

  if (Resources) {
    for (const [logicalId, resource] of Object.entries(Resources)) {
      if (resource.Type) {
        const count = resourceTypeCounts.get(resource.Type) || 0;
        resourceTypeCounts.set(resource.Type, count + 1);
      }
    }
    
    // Log the counts
    console.log('\nResource Types:');
    resourcesByCount = Array.from(resourceTypeCounts.entries())
      .sort(([_, a], [__, b]) => b - a); // Sort by count descending

    const resourceTypesNoCustomResources = resourcesByCount.filter(([type, count]) => {
      return !type.startsWith('Custom::') && !type.startsWith('AWS::CloudFormation::CustomResource')
    })
    
    const promptItems = resourceTypesNoCustomResources.map(([type, count]) => {
      const word = (count === 1) ? 'instance' : 'instances'
      return `- ${count} ${word} of ${type}`
    })

    resourcesPrompt = `
You are an expert AWS Billing consultant.

Below is a list of resources in this CloudFormation stack. Please provide me with their associated costs.

Please output the response with Fixed costs first (For example KMS key costs $1 per month per key), then Variable costs (for example requests to S3 cost $0.01 per 1000 requests).

If any Fixed Monthly Costs are present, please provide the total monthly cost for all Fixed Monthly Costs.

If any Variable Costs are present, please provide some scenarios for how much they might cost. When calculating the scenarios, MAKE SURE to use the correct pricing for the resource (for example, $0.20 per 1M requests for Lambda). Also make sure to include the free tier in your calculations of the scenarios. For any resource that can have on demand billing, assume that is billing mode (For example DynamoDB on demand billing is $0.25 per 1M requests).

At the bottom of your response add the total fixed and estimated variable costs in bold.

Highlight high cost impact resources and suggest optimizations and or alternative approaches.

Here are the resources and their counts:

${promptItems.join('\n')}
    `
  }

  return {
    resourceTypeCounts,
    resourcesByCount,
    resourcesPrompt
  };
}

module.exports = {
  getResourceCounts
} 