const fs = require('fs')
const yaml = require('js-yaml')

function cleanCloudFormation(template, options = {}) {
  if (!template) {
    throw new Error('Template is required')
  }
  /*

  console.log('template', template)
  /** */


  // Clean CDK-specific elements
  removeRootCdkNag(template);
  removeBootstrapVersionRule(template);
  removeBootstrapVersionParameter(template);

  // Clean template structure
  cleanMetadata(template);
  removeCdkMetadata(template);
  removeMetadataCondition(template);
  cleanConditionNames(template);
  cleanResourceNames(template);
  removeCdkTags(template);
  transformParameterArrays(template);
  sortResourceKeys(template);

  /* Handle logical ID replacements if specified */
  if (options.replaceLogicalIds) {
    for (const { pattern, replacement } of options.replaceLogicalIds) {
      replaceLogicalIds(template, pattern, replacement);
    }
  }

  // Transform and sort
  const transformedTemplate = transformIntrinsicFunctions(sortTopLevelKeys(template));
  

  // Convert to YAML
  let yamlContent = yaml.dump(transformedTemplate, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    noArrayIndent: false,
    flowStyle: false,
    styles: {
      '!!null': 'empty',
      '!!str': 'plain'
    },
    quotingType: '"',  // Use double quotes instead of single quotes
    forceQuotes: false // Only quote when necessary
  });

  // Fix array indentation
  yamlContent = yamlContent.replace(/^(\s+)[^-\s].*:\n\1-\s/gm, '$1$&  ');

  // Apply YAML formatting
  yamlContent = yamlContent.replace(/Ref::/g, '!');
  yamlContent = yamlContent.replace(/!(Ref|GetAtt|Join|Sub|Select|Split|FindInMap|If|Not|Equals|And|Or):/g, '!$1');
  
  /* Fold DependsOn arrays if 2 or less into a single line */
  yamlContent = yamlContent.replace(
    /^(\s+)DependsOn:\n(?:\1[\s-]+.+?\n)+/gm,
    (match) => {
      const values = match
        .split('\n')
        .filter(line => line.includes('-'))
        .map(line => line.substring(line.indexOf('-') + 1).trim())
        .filter(Boolean);

      // Only transform if there are 1 or 2 values
      if (values.length > 2) {
        return match;
      }

      const indent = match.match(/^\s+/)[0];
      return `${indent}DependsOn: [ ${values.join(', ')} ]\n`;
    }
  );

  yamlContent = insertBlankLines(yamlContent);
  yamlContent = yamlContent.replace(/\n\n\n+/g, '\n\n');
  yamlContent = yamlContent.replace(/(^Resources:\n)\n/, '$1');
  yamlContent = yamlContent.replace(/^(\s+)!(Equals)\n\1-\s+(.+?)\n\1-\s+(.+?)$/gm, '$1!$2 [ $3, $4 ]');
  yamlContent = yamlContent.replace(
    /^(\s+)-\s+!Equals\n\1\s+-\s+(.+?)\n\1\s+-\s+(.+?)$/gm,
    '$1- !Equals [ $2, $3 ]'
  );
  yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!(?:Sub|Ref|GetAtt)\s.+)$/gm, '$1$2: $3');
  yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!Equals\s+\[.+?\])$/gm, '$1$2: $3');
  yamlContent = yamlContent.replace(
    /^(\s+)AllowedValues:\n(?:\1-\s+(.+?)(?:\n|$))+/gm,
    (match) => {
      const values = match
        .split('\n')
        .filter(line => line.includes('-'))
        .map(line => {
          const value = line.substring(line.indexOf('-') + 1).trim();
          return value.match(/^['"].*['"]$/) ? value : value;
        })
        .filter(Boolean);

      const indent = match.match(/^\s+/)[0];
      return `${indent}AllowedValues: [${values.join(', ')}]\n`;
    }
  );

  // Collect names before any transformations
  const names = collectNames(template);

  // Log collected names at the end
  if (names.length > 0) {
    console.log('\nFound the following resource names:');
    names.forEach(({ path, value }) => {
      console.log(`${path}: ${value}`);
    });
  }

  return yamlContent;
}

// Add this new function at the start
function removeRootCdkNag(template) {
  if (template.Metadata && template.Metadata.cdk_nag) {
    delete template.Metadata.cdk_nag;
    
    // Remove empty Metadata object
    if (Object.keys(template.Metadata).length === 0) {
      delete template.Metadata;
    }
  }
}

// Add this new function after removeRootCdkNag
function removeBootstrapVersionRule(template) {
  if (template.Rules && template.Rules.CheckBootstrapVersion) {
    delete template.Rules.CheckBootstrapVersion;
    
    // Remove empty Rules object
    if (Object.keys(template.Rules).length === 0) {
      delete template.Rules;
    }
  }
}

// Add this new function after removeBootstrapVersionRule
function removeBootstrapVersionParameter(template) {
  if (template.Parameters && 
      template.Parameters.BootstrapVersion && 
      template.Parameters.BootstrapVersion.Default && 
      template.Parameters.BootstrapVersion.Default.startsWith('/cdk-bootstrap/')) {
    
    delete template.Parameters.BootstrapVersion;
    
    // Remove empty Parameters object
    if (Object.keys(template.Parameters).length === 0) {
      delete template.Parameters;
    }
  }
}

// Add this new function after removeBootstrapVersionParameter
function sortTopLevelKeys(template) {
  const order = [
    'AWSTemplateFormatVersion',
    'Transform',
    'Description',
    'Metadata',
    'Rules',
    'Mappings',
    'Parameters',
    'Conditions',
    'Resources',
    'Outputs'
  ];

  // Create a new object with sorted keys
  const sortedTemplate = {};
  
  // Add keys in specified order if they exist
  order.forEach(key => {
    if (template[key] !== undefined) {
      sortedTemplate[key] = template[key];
    }
  });

  // Add any remaining keys that weren't in our order list
  Object.keys(template).forEach(key => {
    if (!order.includes(key)) {
      sortedTemplate[key] = template[key];
    }
  });

  return sortedTemplate;
}


// Function to recursively remove aws:cdk:path and cfn_nag from Metadata
function cleanMetadata(obj) {
  if (obj && typeof obj === 'object') {
    if (obj.Metadata) {
      // Remove aws:cdk:path
      if (obj.Metadata['aws:cdk:path']) {
        delete obj.Metadata['aws:cdk:path']
      }
      // Remove cfn_nag
      if (obj.Metadata.cfn_nag) {
        delete obj.Metadata.cfn_nag
      }
      // Remove cdk_nag
      if (obj.Metadata.cdk_nag) {
        delete obj.Metadata.cdk_nag
      }
      // Remove aws:asset keys
      Object.keys(obj.Metadata).forEach(key => {
        if (key.startsWith('aws:asset:')) {
          delete obj.Metadata[key];
        }
      });
      // Remove empty Metadata objects
      if (Object.keys(obj.Metadata).length === 0) {
        delete obj.Metadata
      }
    }

    // Recursively process all properties
    for (const key in obj) {
      cleanMetadata(obj[key])
    }
  }
}

// Function to remove CDK Metadata resources
function removeCdkMetadata(template) {
  const resources = template.Resources
  for (const key in resources) {
    if (resources[key].Type === 'AWS::CDK::Metadata') {
      delete resources[key]
    }
  }
}

// Add this function after the existing functions
function shouldTransformJoinToSub(joinArgs) {
  // Only transform if it's a Join with empty string separator
  if (!Array.isArray(joinArgs) || joinArgs[0] !== '' || !Array.isArray(joinArgs[1])) {
    return false
  }

  // Check if any of the elements are Ref or GetAtt
  return joinArgs[1].some(
    (item) => typeof item === 'object' && (item['Ref::Ref'] !== undefined || item['Ref::GetAtt'] !== undefined),
  )
}

function transformJoinToSub(joinArgs) {
  const parts = joinArgs[1]
  let template = ''

  for (const part of parts) {
    if (typeof part === 'string') {
      template += part
    } else if (part['Ref::Ref']) {
      template += '${' + part['Ref::Ref'] + '}'
    } else if (part['Ref::GetAtt']) {
      template += '${' + part['Ref::GetAtt'] + '}'
    }
  }

  return { 'Ref::Sub': template }
}

// Function to transform intrinsic functions to shorthand
function transformIntrinsicFunctions(obj) {
  if (obj && typeof obj === 'object') {
    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => transformIntrinsicFunctions(item))
    }

    // Create new object to store transformed key-values
    const transformed = {}

    for (const [key, value] of Object.entries(obj)) {
      // Transform the known intrinsic functions to shorthand
      switch (key) {
        case 'Fn::Join':
          const transformedValue = transformIntrinsicFunctions(value)
          if (shouldTransformJoinToSub(transformedValue)) {
            Object.assign(transformed, transformJoinToSub(transformedValue))
          } else {
            transformed['Ref::Join'] = transformedValue
          }
          break
        case 'Fn::Sub':
          transformed['Ref::Sub'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::GetAtt':
          // Convert from array format to dot notation
          if (Array.isArray(value)) {
            transformed['Ref::GetAtt'] = value.join('.')
          } else {
            transformed['Ref::GetAtt'] = value
          }
          break
        case 'Fn::Select':
          transformed['Ref::Select'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::Split':
          transformed['Ref::Split'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::FindInMap':
          transformed['Ref::FindInMap'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::If':
          transformed['Ref::If'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::Not':
          transformed['Ref::Not'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::Equals':
          transformed['Ref::Equals'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::And':
          transformed['Ref::And'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::Or':
          transformed['Ref::Or'] = transformIntrinsicFunctions(value)
          break
        case 'Ref':
          transformed['Ref::Ref'] = value
          break
        default:
          // Recursively transform nested objects
          transformed[key] = transformIntrinsicFunctions(value)
      }
    }
    return transformed
  }
  return obj
}

// Add this new function
function removeMetadataCondition(template) {
  if (template.Conditions && template.Conditions.CDKMetadataAvailable) {
    delete template.Conditions.CDKMetadataAvailable

    // Remove the Conditions object if it's empty
    if (Object.keys(template.Conditions).length === 0) {
      delete template.Conditions
    }
  }
}

// Add this new function after removeMetadataCondition
function cleanConditionNames(template) {
  // Skip if no conditions
  if (!template.Conditions) return

  // Updated pattern to match:
  // - Any alphanumeric characters followed by
  // - 8 character hex code at the end
  const postfixPattern = /^([A-Za-z0-9]+?)([0-9A-F]{8})$/
  const conditionRenames = {}

  // First pass: identify conditions that can be renamed
  for (const conditionName of Object.keys(template.Conditions)) {
    const match = conditionName.match(postfixPattern)
    if (match) {
      const baseName = match[1]
      // Check if base name already exists
      const baseNameExists = Object.keys(template.Conditions).some(
        (name) =>
          name !== conditionName && // not the same condition
          (name === baseName || name.startsWith(baseName + '[')), // exact match or array index
      )

      if (!baseNameExists) {
        conditionRenames[conditionName] = baseName
      }
    }
  }

  // Helper function to update condition references in an object
  function updateConditionRefs(obj) {
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      obj.forEach((item) => updateConditionRefs(item))
      return
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'Condition' && typeof value === 'string' && conditionRenames[value]) {
        obj[key] = conditionRenames[value]
      } else if (key === 'Fn::If' && Array.isArray(value) && conditionRenames[value[0]]) {
        value[0] = conditionRenames[value[0]]
      } else if (typeof value === 'object') {
        updateConditionRefs(value)
      }
    }
  }

  // Second pass: rename conditions and update references
  for (const [oldName, newName] of Object.entries(conditionRenames)) {
    // Rename the condition
    template.Conditions[newName] = template.Conditions[oldName]
    delete template.Conditions[oldName]
  }

  // Update all condition references in the template
  updateConditionRefs(template.Resources)
  updateConditionRefs(template.Outputs)
}

// Add this new function after cleanConditionNames
function cleanResourceNames(template) {
  // Skip if no resources
  if (!template.Resources) return

  const postfixPattern = /^([A-Za-z0-9]+?)([0-9A-F]{8})$/
  const resourceRenames = {}

  // First pass: identify resources that can be renamed
  for (const resourceName of Object.keys(template.Resources)) {
    const match = resourceName.match(postfixPattern)
    if (match) {
      const baseName = match[1]
      // Check if base name already exists
      const baseNameExists = Object.keys(template.Resources).some(
        (name) =>
          name !== resourceName && // not the same resource
          (name === baseName || name.startsWith(baseName + '[')), // exact match or array index
      )

      if (!baseNameExists) {
        resourceRenames[resourceName] = baseName
      }
    }
  }

  // Helper function to update resource references in an object
  function updateResourceRefs(obj) {
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      // Handle DependsOn arrays
      if (obj.some((item) => typeof item === 'string' && resourceRenames[item])) {
        for (let i = 0; i < obj.length; i++) {
          if (typeof obj[i] === 'string' && resourceRenames[obj[i]]) {
            obj[i] = resourceRenames[obj[i]]
          }
        }
      } else {
        obj.forEach((item) => updateResourceRefs(item))
      }
      return
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'Ref' && typeof value === 'string' && resourceRenames[value]) {
        obj[key] = resourceRenames[value]
      } else if (key === 'Fn::GetAtt' && Array.isArray(value) && resourceRenames[value[0]]) {
        value[0] = resourceRenames[value[0]]
      } else if (key === 'DependsOn') {
        // Handle both string and array DependsOn
        if (typeof value === 'string' && resourceRenames[value]) {
          obj[key] = resourceRenames[value]
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] === 'string' && resourceRenames[value[i]]) {
              value[i] = resourceRenames[value[i]]
            }
          }
        }
      } else if (typeof value === 'object') {
        updateResourceRefs(value)
      }
    }
  }

  // Second pass: rename resources and update references
  for (const [oldName, newName] of Object.entries(resourceRenames)) {
    // Rename the resource
    template.Resources[newName] = template.Resources[oldName]
    delete template.Resources[oldName]
  }

  // Update all resource references in the template
  updateResourceRefs(template.Resources)
  updateResourceRefs(template.Outputs)
  if (template.Conditions) {
    updateResourceRefs(template.Conditions)
  }
}

// Add this new function after cleanResourceNames
function removeCdkTags(template) {
  if (!template.Resources) return;

  for (const resource of Object.values(template.Resources)) {
    if (resource.Properties && resource.Properties.Tags) {
      // Ensure Tags is an array
      const tags = Array.isArray(resource.Properties.Tags) 
        ? resource.Properties.Tags 
        : [resource.Properties.Tags];

      // Filter out aws-cdk: tags and cr-owned tags
      resource.Properties.Tags = tags.filter(tag => {
        // Check if tag is a valid object with a Key property
        return tag && 
               typeof tag === 'object' && 
               tag.Key && 
               typeof tag.Key === 'string' && 
               !tag.Key.startsWith('aws-cdk:') && 
               !tag.Key.includes('cr-owned:');
      });

      // Remove empty Tags array
      if (resource.Properties.Tags.length === 0) {
        delete resource.Properties.Tags;
      }
    }
  }
}

// Add this new function after removeCdkTags
function transformParameterArrays(template) {
  if (!template.Parameters) return;

  for (const param of Object.values(template.Parameters)) {
    if (param.AllowedValues && 
        Array.isArray(param.AllowedValues) && 
        param.AllowedValues.every(v => typeof v === 'string')) {
      // Mark this array for compact formatting
      Object.defineProperty(param.AllowedValues, 'isCompactStringArray', {
        value: true,
        enumerable: false
      });
    }
  }
}

// Add this new function after transformParameterArrays
function sortIAMPolicyProperties(resource) {
  if (resource.Type !== 'AWS::IAM::Policy' || !resource.Properties) {
    return resource;
  }

  const order = [
    'PolicyName',
    'Roles',
    'PolicyDocument',
  ];

  const sortedProperties = {};
  
  // Add properties in specified order if they exist
  order.forEach(key => {
    if (resource.Properties[key] !== undefined) {
      sortedProperties[key] = resource.Properties[key];
    }
  });

  // Add any remaining properties that weren't in our order list
  Object.keys(resource.Properties).forEach(key => {
    if (!order.includes(key)) {
      sortedProperties[key] = resource.Properties[key];
    }
  });

  resource.Properties = sortedProperties;
  return resource;
}

// Modify the sortResourceKeys function to include IAM Policy sorting
function sortResourceKeys(template) {
  if (!template.Resources) return;

  const order = [
    'Type',
    'Condition',
    'DependsOn',
    'DeletionPolicy',
    'CreationPolicy',
    'UpdatePolicy',
    'UpdateReplacePolicy',
    'Properties',
    'Metadata'
  ];

  for (const resourceKey in template.Resources) {
    const resource = template.Resources[resourceKey];
    const sortedResource = {};
    
    // Add keys in specified order if they exist
    order.forEach(key => {
      if (resource[key] !== undefined) {
        sortedResource[key] = resource[key];
      }
    });

    // Add any remaining keys that weren't in our order list
    Object.keys(resource).forEach(key => {
      if (!order.includes(key)) {
        sortedResource[key] = resource[key];
      }
    });

    // Sort IAM Policy properties if applicable
    template.Resources[resourceKey] = sortIAMPolicyProperties(sortedResource);
  }
}

function insertBlankLines(content) {
  const twoSpaces = '  '
  return content.replace(
    // /((?<!^\s*$\n)^\s+[A-Za-z0-9_-]+:\s*\n\s+Type:)/gm,
    /((?<!^\s*$\n)^  [A-Za-z0-9_-]+:\s*\n\s+Type:)/gm, // two space
    '\n$1'
  )
}

function loadData(fileContents) {
  // Parse the template - try JSON first, then YAML if that fails
  let template;
  try {
    template = JSON.parse(fileContents);
  } catch (e) {
    template = yaml.load(fileContents);
  }

  return template
}

function splitResourceType(resourceType) {
  const [vendor, service, type] = resourceType.split('::')
  return {
    vendor,
    service,
    type,
    name: service + type
  }
}


function handleReplacement(pattern, replacement, logicalId, resource) {
  if (typeof replacement === 'string') {
    return logicalId.replace(pattern, replacement);
  } else if (replacement instanceof RegExp) {
    return logicalId.replace(pattern, replacement);
  } else if (typeof replacement === 'function') {
    const resourceDetails = splitResourceType(resource.Type)
    const payload = {
      logicalId,
      resourceDetails,
      resource,
      pattern
    }
    return replacement(payload);
  }
}

// Add this new function to handle logical ID replacements
function replaceLogicalIds(template, pattern, replacement) {
  if (!template.Resources) return;

  const replacements = {};
  const existingNames = new Set(Object.keys(template.Resources));
  const proposedNames = new Map(); // Track all proposed new names

  // First pass: identify resources to rename and check for collisions
  for (const logicalId of Object.keys(template.Resources)) {
    let newLogicalId;
    if (typeof pattern === 'string') {
      // String replacement
      newLogicalId = handleReplacement(pattern, replacement, logicalId, template.Resources[logicalId]);
    } else if (pattern instanceof RegExp) {
      // Regex replacement
      newLogicalId = handleReplacement(pattern, replacement, logicalId, template.Resources[logicalId]);
    }

    if (newLogicalId && newLogicalId !== logicalId) {
      // Check if the new name would collide with:
      // 1. An existing resource that won't be renamed
      // 2. Another resource that would be renamed to the same name
      const wouldCollide = (
        (existingNames.has(newLogicalId) && !proposedNames.has(logicalId)) || 
        Array.from(proposedNames.values()).includes(newLogicalId)
      );

      if (wouldCollide) {
        console.warn(`Warning: Skipping rename of '${logicalId}' to '${newLogicalId}' due to potential collision`);
        continue;
      }

      proposedNames.set(logicalId, newLogicalId);
      replacements[logicalId] = newLogicalId;
    }
  }

  // Helper function to update references
  function updateReferences(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      // Handle DependsOn arrays
      if (obj.some(item => typeof item === 'string' && replacements[item])) {
        for (let i = 0; i < obj.length; i++) {
          if (typeof obj[i] === 'string' && replacements[obj[i]]) {
            obj[i] = replacements[obj[i]];
          }
        }
      } else {
        obj.forEach(item => updateReferences(item));
      }
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'Ref' && typeof value === 'string' && replacements[value]) {
        obj[key] = replacements[value];
      } else if (key === 'Fn::GetAtt' && Array.isArray(value) && replacements[value[0]]) {
        value[0] = replacements[value[0]];
      } else if (key === 'DependsOn') {
        if (typeof value === 'string' && replacements[value]) {
          obj[key] = replacements[value];
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] === 'string' && replacements[value[i]]) {
              value[i] = replacements[value[i]];
            }
          }
        }
      } else if (typeof value === 'object') {
        updateReferences(value);
      }
    }
  }

  // Second pass: rename resources and update references
  for (const [oldId, newId] of Object.entries(replacements)) {
    template.Resources[newId] = template.Resources[oldId];
    delete template.Resources[oldId];
  }

  // Update all references
  updateReferences(template.Resources);
  updateReferences(template.Outputs);
  if (template.Conditions) {
    updateReferences(template.Conditions);
  }
}

const ignoreNames = [
  'AttributeName',
  'HeaderName'
]

const ignorePaths = [
  'AccountRecoverySetting'
]

// Add this new function to collect names
function collectNames(template) {
  const names = new Set();
  
  function findNames(obj, path = []) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => findNames(item, [...path, index]));
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && 
          (key === 'Name' || 
           key === 'AliasName' || 
           key === 'PolicyName' || 
           key === 'RoleName' ||
           key === 'BucketName' ||
           key === 'TableName' ||
           key === 'FunctionName' ||
           key.endsWith('Name'))
        ) {
        
        if (ignoreNames.includes(key)) {
          return;
        }

        const keyPath = [...path, key].join('.')
        if (ignorePaths.some(ignorePath => keyPath.includes(ignorePath))) {
          return;
        }

        names.add({
          path: keyPath,
          value: value
        });
      } else if (typeof value === 'object') {
        findNames(value, [...path, key]);
      }
    }
  }

  findNames(template.Resources, ['Resources']);
  
  return Array.from(names).sort((a, b) => a.path.localeCompare(b.path));
}

function test() {
  // Use the function at the bottom of the file
  const fileContents = fs.readFileSync('./fixtures/passwordless.json', 'utf8');
  const template = loadData(fileContents)
  const cleanedYaml = cleanCloudFormation(template, {
    replaceLogicalIds: [
      {
        pattern: 'Passwordless', 
        replacement: '' 
      },
      {
        pattern: /Passwordless$/,
        replacement: (payload) => {
          const { logicalId, resourceDetails } = payload
          const { name } = resourceDetails
          return logicalId.replace(/Passwordless$/, '').replace(name, '')
        }
      },
      {
        pattern: /Passwordless/gi,
        replacement: (payload) => {
          const { logicalId, resourceDetails, pattern } = payload
          return logicalId.replace(pattern, '')
        }
      }
    ]
  });
  
  // Save both the cleaned version and the original as YAML
  fs.writeFileSync('outputs/clean-passwordless.yaml', cleanedYaml);

  const dirtyYaml = yaml.dump(yaml.load(fileContents), {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    noArrayIndent: true,
    flowStyle: false,
  })
  fs.writeFileSync('outputs/dirty-passwordless.yaml', dirtyYaml);

  // Log the number of lines in the cleaned and dirty files
  const cleanLines = cleanedYaml.split('\n').length;
  const dirtyLines = dirtyYaml.split('\n').length;
  console.log(`Clean lines: ${cleanLines}`);
  console.log(`Dirty lines: ${dirtyLines}`);
  // Log savings
  const savings = ((dirtyLines - cleanLines) / dirtyLines) * 100;
  console.log(`Savings: ${savings.toFixed(2)}%`);
  console.log('Transformation complete! Output written to clean-passwordless.yaml');
}

test()
