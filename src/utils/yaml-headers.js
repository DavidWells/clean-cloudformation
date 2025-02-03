const SECTION_HEADERS = {
  Rules: {
    title: 'Cloudformation Rules',
    description: 'Rules that validate parameter selections'
  },
  Mappings: {
    title: 'Cloudformation Mappings',
    description: 'Maps keys to values, similar to a lookup table'
  },
  Parameters: {
    title: 'Cloudformation Parameters',
    description: 'Input parameters for the stack'
  },
  Conditions: {
    title: 'Cloudformation Conditions',
    description: 'Conditions that control resource creation'
  },
  Resources: {
    title: 'Cloudformation Resources',
    description: 'AWS resources to be created'
  },
  Outputs: {
    title: 'Cloudformation Outputs',
    description: 'Stack output values'
  }
};

function addSectionHeaders(yamlContent) {
  let result = yamlContent;
  const lineLength = 82; // Total length of separator line
  
  // Add headers for each section
  for (const [section, { title }] of Object.entries(SECTION_HEADERS)) {
    const sectionPattern = new RegExp(`^${section}:`, 'm');
    if (sectionPattern.test(result)) {
      // Calculate padding needed for title line
      const separator = '-'.repeat(lineLength);
      const titleText = ` ${title} `;
      const padLength = Math.floor((lineLength - titleText.length) / 2);
      const titleLine = '-'.repeat(padLength) + titleText + '-'.repeat(padLength);
      
      // Adjust for odd lengths to match separator exactly
      const finalTitleLine = titleLine.length < lineLength ? 
        titleLine + '-' : 
        titleLine;

      const header = `# ${separator}
# ${finalTitleLine}
# ${separator}
`;
      result = result.replace(sectionPattern, `${header}${section}:`);
    }
  }
  
  return result;
}

module.exports = {
  addSectionHeaders
}; 