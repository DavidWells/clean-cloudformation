const path = require('path')
const fs = require('fs').promises
const yaml = require('js-yaml')
const { loadSchema, loadAllSchemas } = require('./utils/schemas')
const { validateTemplate } = require('./utils/validators')
const { formatTemplate } = require('./utils/formatters')
const { formatYaml } = require('./utils/formatters-yaml')
const { collectNames } = require('./utils/collect-name-props')
const { getResourceCounts } = require('./utils/resource-count')
const { addSectionHeaders } = require('./utils/yaml-headers')
const { stringify, extractYamlComments } = require('@davidwells/yaml-utils')


async function cleanCloudFormation(input, opts = {}) {
  const _options = opts || {}
  const defaultOptions = {
    cleanCode: true
  }
  const options = { 
    ...defaultOptions, 
    ..._options 
  }

  if (!input) {
    throw new Error('Input is required')
  }

  input = await resolveInput(input)

  // Load and parse the template
  const template = parseInput(input, options)

  if (!template) {
    throw new Error('Template is required')
  }

  // console.log('template', template)
  // process.exit(1)

  // Get resource counts and prompts
  const { resourcesByCount, resourcesPrompt } = getResourceCounts(template);

  /* Process the template object */
  const { randomStrings } = formatTemplate(template)
  // console.log('randomStrings', randomStrings)

  /* Handle logical ID replacements if specified */
  if (options.replaceLogicalIds) {
    for (const { pattern, replacement } of options.replaceLogicalIds) {
      replaceLogicalIds(template, pattern, replacement)
    }
  }

  // Transform and sort
  const transformedTemplate = transformIntrinsicFunctions(sortTopLevelKeys(template))
  
  // Validate the transformed template
  const isValid = await validateTemplate(transformedTemplate)

  if (!isValid && options.strict) {
    throw new Error('Template validation failed')
  }

  const commentsData = extractYamlComments(input)
  commentsData.comments = cleanKeys(commentsData.comments, randomStrings)
  // process.exit(1)

  let yamlContentTwo = stringify(transformedTemplate, {
    originalString: input,
    commentData: commentsData,
    lineWidth: -1
  })

  // Convert to YAML
  let yamlContent
  try {
    yamlContent = yaml.dump(transformedTemplate, {
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
    })
    // console.log('yamlContent', yamlContent)
    // process.exit(1)
  } catch(e) {
    // console.log('error', e)
    // process.exit(1)
  }

  yamlContent = formatYaml(yamlContent)
  yamlContent = addSectionHeaders(yamlContent)

  yamlContentTwo = formatYaml(yamlContentTwo)
  yamlContentTwo = addSectionHeaders(yamlContentTwo)


  // Collect names before any transformations
  const { foundPropNames, prompt } = await collectNames(template, {
    // returnAll: true
  })

  return {
    yaml: yamlContent,
    comments: commentsData,
    yamlTwo: yamlContentTwo,
    json: transformedTemplate,
    resourcesByCount,
    resourcesNamePropertiesFound: foundPropNames,
    prompts: {
      resourceCosts: resourcesPrompt,
      resourceNames: prompt
    }
  }
}

function cleanKeys(arr, randomStrings) {
  return arr.map(item => ({
    ...item,
    key: randomStrings.reduce((key, suffix) => key.replace(suffix, ''), item.key)
  }))
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
  ]

  // Create a new object with sorted keys
  const sortedTemplate = {}
  
  // Add keys in specified order if they exist
  order.forEach(key => {
    if (template[key] !== undefined) {
      sortedTemplate[key] = template[key]
    }
  })

  // Add any remaining keys that weren't in our order list
  Object.keys(template).forEach(key => {
    if (!order.includes(key)) {
      sortedTemplate[key] = template[key]
    }
  })

  return sortedTemplate
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



async function resolveInput(input) {
  if (typeof input === 'string' && (input.endsWith('.yml') || input.endsWith('.yaml') || input.endsWith('.json'))) {
    return fs.readFile(input, 'utf8')
  }
  return input
}

function parseInput(input, options = {}) {
  if (typeof input === 'object') {
    return input
  }

  if (typeof input !== 'string') {
    throw new Error('Input must be an object or a string')
  }

  let template
  // Parse the template - try JSON first, then YAML if that fails
  try {
    template = JSON.parse(input)
  } catch (e) {
    let cleanYml = input
    if (options.cleanCode) {
      // Replace ZipFile: |2- pattern with ZipFile: |
      cleanYml = input.replace(/^([ \t]*[A-Za-z0-9_-]+:) \|2\-$/gm, '$1 |-\n')
    }
    // console.log('cleanYml', cleanYml)
    // process.exit(1)

    // console.log('cleanYml', cleanYml)
    // process.exit(1)
    // console.log('error', e)
    try {
      template = yaml.load(cleanYml)
    } catch (e) {
      console.log('Loading YAML template failed', e)
      // Fallback to original input
      try {
        template = yaml.load(input)
      } catch (e) {
        console.log('Loading YAML template failed', e)
        process.exit(1)
      }
    }
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
    return logicalId.replace(pattern, replacement)
  } else if (replacement instanceof RegExp) {
    return logicalId.replace(pattern, replacement)
  } else if (typeof replacement === 'function') {
    const resourceDetails = splitResourceType(resource.Type)
    const payload = {
      logicalId,
      resourceDetails,
      resource,
      pattern
    }
    return replacement(payload)
  }
}

function findCommonRandomStringsInIds(logicalIds) {
  const postfixes = new Map(); // Map to store postfix -> count
  
  // Look for patterns at the end of logical IDs that:
  // 1. 40-char hex pattern (like 663240D697c3cdfc601da74f263d2bb8dcbb4a90)
  // 2. Standard 8-char pattern (like ADDA7DEB)
  // 3. Longer hex pattern (like 1cd5ccdaa0c6)
  const patterns = [
    /[A-Fa-f0-9]{40}$/g,  // 40-char hex deployment id (both upper and lower case)
    /[A-Z0-9]{8}/g,    // Standard pattern (ADDA7DEB)
    /\d[A-Z0-9]{7}/g,  // Starts with number (03AA31B2)
    /[A-Z][0-9A-Z]{7}/g, // Starts with letter (E5522E5D)
    /[a-f0-9]{12}$/g   // 12-char lowercase hex (1cd5ccdaa0c6)
  ];
  
  for (const id of logicalIds) {
    // Try each pattern
    for (const pattern of patterns) {
      const matches = Array.from(id.matchAll(pattern));
      for (const match of matches) {
        const postfix = match[0];
        // For standard 8-char patterns
        if (postfix.length === 8) {
          if (/[A-Z]/.test(postfix) && /[0-9]/.test(postfix)) {
            postfixes.set(postfix, (postfixes.get(postfix) || 0) + 1);
          }
        }
        // For 40-char or 12-char hex patterns
        else if (postfix.length === 40 || postfix.length === 12) {
          if (/[A-Fa-f]/.test(postfix) && /[0-9]/.test(postfix)) {
            postfixes.set(postfix, (postfixes.get(postfix) || 0) + 1);
          }
        }
      }
    }
  }

  return Array.from(postfixes.entries())
    .sort(([p1, c1], [p2, c2]) => {
      // First sort by length (descending)
      if (p1.length !== p2.length) {
        return p2.length - p1.length;
      }
      // Then by count (descending)
      return c2 - c1;
    });
}

// Modify replaceLogicalIds to handle postfix removal
function replaceLogicalIds(template, pattern, replacement) {
  if (!template.Resources) return;

  const logicalIds = Object.keys(template.Resources);
  
  // Find common postfixes before doing other replacements
  const commonRandomStringsInIds = findCommonRandomStringsInIds(logicalIds);
  //*
  console.log('commonRandomStringsInIds', commonRandomStringsInIds)
  //process.exit(1)
  /** */
  
  // If we found common postfixes, add them to our replacement patterns
  const postfixReplacements = new Map();
  for (const [postfix, count] of commonRandomStringsInIds) {
    // Only consider postfixes that appear in multiple resources
    if (count >= 1) {
      const postfixPattern = new RegExp(`${postfix}`);
      postfixReplacements.set(postfixPattern, '');
    }
  }

  const replacements = {};
  const existingNames = new Set(Object.keys(template.Resources));
  const proposedNames = new Map(); // Track all proposed new names

  // First pass: identify resources to rename and check for collisions
  for (const logicalId of logicalIds) {
    let newLogicalId = logicalId;

    // First apply postfix removals
    for (const [postfixPattern, postfixReplacement] of postfixReplacements) {
      // console.log('postfixPattern', postfixPattern)
      newLogicalId = newLogicalId.replace(postfixPattern, postfixReplacement);
    }

    // Then apply the main pattern/replacement
    if (typeof pattern === 'string') {
      newLogicalId = handleReplacement(pattern, replacement, newLogicalId, template.Resources[logicalId]);
    } else if (pattern instanceof RegExp) {
      newLogicalId = handleReplacement(pattern, replacement, newLogicalId, template.Resources[logicalId]);
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
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      // Handle DependsOn arrays
      if (obj.some(item => typeof item === 'string' && replacements[item])) {
        for (let i = 0; i < obj.length; i++) {
          if (typeof obj[i] === 'string' && replacements[obj[i]]) {
            obj[i] = replacements[obj[i]]
          }
        }
      } else {
        obj.forEach(item => updateReferences(item))
      }
      return
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'Ref' && typeof value === 'string' && replacements[value]) {
        obj[key] = replacements[value]
      } else if (key === 'Fn::GetAtt' && Array.isArray(value) && replacements[value[0]]) {
        value[0] = replacements[value[0]]
      } else if (key === 'DependsOn') {
        if (typeof value === 'string' && replacements[value]) {
          obj[key] = replacements[value]
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] === 'string' && replacements[value[i]]) {
              value[i] = replacements[value[i]]
            }
          }
        }
      } else if (typeof value === 'object') {
        updateReferences(value)
      }
    }
  }

  // Second pass: rename resources and update references
  for (const [oldId, newId] of Object.entries(replacements)) {
    template.Resources[newId] = template.Resources[oldId]
    delete template.Resources[oldId]
  }

  // Update all references
  updateReferences(template.Resources)
  updateReferences(template.Outputs)
  if (template.Conditions) {
    updateReferences(template.Conditions)
  }
}

module.exports = {
  cleanCloudFormation,
  loadAllSchemas,
  loadSchema
}
