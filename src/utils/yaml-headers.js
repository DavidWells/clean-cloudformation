const SECTION_HEADERS = {
  Rules: {
    title: 'CloudFormation Rules',
    description: 'Rules that validate parameter selections'
  },
  Mappings: {
    title: 'CloudFormation Mappings',
    description: 'Maps keys to values, similar to a lookup table'
  },
  Parameters: {
    title: 'CloudFormation Parameters',
    description: 'Input parameters for the stack'
  },
  Conditions: {
    title: 'CloudFormation Conditions',
    description: 'Conditions that control resource creation'
  },
  Resources: {
    title: 'CloudFormation Resources',
    description: 'AWS resources to be created'
  },
  Outputs: {
    title: 'CloudFormation Outputs',
    description: 'Stack output values'
  }
};

function makeHeaderPatternMatcher(keyword) {
 return new RegExp(`^((?:#.*\\n)*)(^|  )${keyword}:`, 'm')
}

function addSectionHeaders(yamlContent) {
  let result = yamlContent;
  const lineLength = 82; // Total length of separator line
  // console.log('addSectionHeaders', result)
  // process.exit(0)
  
  // Add headers for each section
  for (const [section, { title }] of Object.entries(SECTION_HEADERS)) {
    const sectionPattern = makeHeaderPatternMatcher(section)
    if (sectionPattern.test(result)) {
      // console.log('sectionPattern', sectionPattern)
      // Calculate padding needed for title line
      const separator = '-'.repeat(lineLength);
      const titleText = ` ${title} `;
      const padLength = Math.floor((lineLength - titleText.length) / 2);
      const titleLine = '-'.repeat(padLength) + titleText + '-'.repeat(padLength);
      
      // Adjust for odd lengths to match separator exactly
      const finalTitleLine = titleLine.length < lineLength ? 
        titleLine + '-' : 
        titleLine;

      const header = `\n# ${separator}
# ${finalTitleLine}
# ${separator}
`;     
      result = result.replace(sectionPattern, `${header}$1${section}:`);

      // If header has more than2 leading newlines, remove one from the result
      result = result.replace(/^(\n{2,})/gm, '\n')

      // console.log('result', result)
    }
  }
  
  return result;
}

module.exports = {
  addSectionHeaders
}; 