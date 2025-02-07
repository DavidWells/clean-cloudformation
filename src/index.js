const fs = require('fs').promises
const yaml = require('js-yaml')
const { loadSchema, loadAllSchemas } = require('./utils/schemas')
const { validateTemplate } = require('./utils/validators')
const { formatTemplateObject } = require('./format')
const { formatYamlString } = require('./utils/formatters/clean-yaml-string')
const { collectNames } = require('./utils/collect-name-props')
const { collectIAMResources } = require('./utils/collect-iam')
const { getResourcesInfo } = require('./utils/collect-resources-info')
const { addSectionHeaders } = require('./utils/formatters/add-yaml-headers')
const { stringify, parse, extractYamlComments } = require('@davidwells/yaml-utils')
const { resolveResources, getLogicalIds } = require('./utils/get-resources')
const https = require('https')
const http = require('http')
const { dumpYaml } = require('./utils/yaml')
const { getCfnYamlSchema } = require('./utils/schemas')
const { deepLog } = require('./utils/logger')
const { createPatch } = require('diff')
const stripAnsi = require('strip-ansi')  // v6.0.1
const jestDiff = require('jest-diff').diff

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
  const { template, originalYaml } = parseInput(input, options)

  // create a deep clone of the original template here
  const originalTemplateClone = JSON.parse(JSON.stringify(template))

  if (!template) {
    throw new Error('Template is required')
  }

  // deepLog('template', template)
  // process.exit(1)

  /*
  const earlyDump = dumpYaml(template)
  console.log('earlyDump', earlyDump)
  process.exit(1)
  /** */
  
  /* Process the template object. Mutates the original template object */
  const { randomStrings } = formatTemplateObject(template)


  // Get resource counts and prompts
  const resourcesInfo = getResourcesInfo(template);
  const { resourcesByCount, totalResources, resourcesPrompt, lambdaFunctions } = resourcesInfo;
  // console.log('randomStrings', randomStrings)

  // First handle random string replacements
  const { Resources, via } = resolveResources(template)
  // console.log('template', template)
  // process.exit(1)
  // console.log('Resources', Resources)

  // console.log('BeforeResources', getLogicalIds(template))
  // process.exit(1)
  if (template.Resources) {
    const logicalIds = getLogicalIds(template)
    const commonRandomStringsInIds = findCommonRandomStringsInIds(logicalIds);
    
    // Create replacement patterns for random strings
    const postfixReplacements = new Map();
    for (const [postfix, count] of commonRandomStringsInIds) {
      if (count >= 1) {
        const postfixPattern = new RegExp(`${postfix}`);
        postfixReplacements.set(postfixPattern, '');
      }
    }

    // Apply random string replacements first
    if (postfixReplacements.size > 0) {
      replaceLogicalIds(template, { postfixReplacements });
    }
  }
  console.log('After random string replacements', getLogicalIds(template))
  // process.exit(1)

  /* Then handle user-specified logical ID replacements if specified */
  if (options.replaceLogicalIds) {
    for (const { pattern, replacement } of options.replaceLogicalIds) {
      console.log('pattern', pattern)
      console.log('replacement', replacement)
      replaceLogicalIds(template, { pattern, replacement });
    }
  }
  // console.log('After user-specified logical ID replacements', Object.keys(template.Resources))
  // process.exit(1)

  // Transform and sort
  const transformedTemplate = transformIntrinsicFunctions(sortTopLevelKeys(template))
  
  // Validate the transformed template
  const isValid = await validateTemplate(transformedTemplate)
  console.log('isValid', isValid)

  if (!isValid && options.strict) {
    throw new Error('Template validation failed')
  }

  const commentsData = extractYamlComments(input)
  commentsData.comments = cleanKeys(commentsData.comments, randomStrings)
  // process.exit(1)

  let yamlWithComments = stringify(transformedTemplate, {
    originalString: input,
    commentData: commentsData,
    lineWidth: -1
  }).trim()
  /*
  console.log('yamlWithComments', yamlWithComments)
  process.exit(1)
  /** */

  /* Convert the transformed template object to YAML */
  let yamlNoComments
  try {
    yamlNoComments = dumpYaml(transformedTemplate)
    /*
    console.log('yamlNoComments', yamlNoComments)
    process.exit(1)
    /** */
  } catch(e) {
    // console.log('error', e)
    // process.exit(1)
  }

  /* Post-process the YAML strings */
  yamlNoComments = formatYamlString(yamlNoComments)
  yamlNoComments = addSectionHeaders(yamlNoComments)
  yamlWithComments = formatYamlString(yamlWithComments)
  yamlWithComments = addSectionHeaders(yamlWithComments)

  /* Collect names after any transformations */
  const { foundPropNames, prompt } = await collectNames(template, {
    // returnAll: true
  })

  // Collect IAM resources and policies
  const { iamResources, inlinePolicies, prompt: iamPrompt } = await collectIAMResources(
    transformedTemplate,
    yamlWithComments // Pass in the YAML string
  )

  // differ here
  let diffOutput = ''
  let patch = ''
  if (typeof input === 'string') {
    // Create a unified diff using originalYaml
    patch = createPatch(
      'CloudFormation Template',
      originalYaml,
      yamlWithComments,
      'Original',
      'Cleaned'
    )

    // Format the diff output
    diffOutput = colorizeDiffForLogging(patch)
  }

  const jsonifyYamlContentTwo = parseInput(yamlWithComments)
  // console.log('jsonifyYamlContentTwo', jsonifyYamlContentTwo.template)
  // process.exit(1)

  // sort the original template and the JSONifyEMO.content2.template by their object keys alphabetically
  const sortedOriginalTemplate = sortObjectKeys(originalTemplateClone)
  const sortedJsonifyYamlContentTwo = sortObjectKeys(jsonifyYamlContentTwo.template)

  // const diff = prettyDiff(sortedOriginalTemplate.Resources, sortedJsonifyYamlContentTwo.Resources)

  const diffJson =  createPatch(
    'CloudFormation Resources',
    JSON.stringify(sortObjectKeys(sortedOriginalTemplate.Resources), null, 2),
    JSON.stringify(sortObjectKeys(sortedJsonifyYamlContentTwo.Resources), null, 2),
    'Original',
    'Cleaned'
  )
  // console.log('diff', diff)
  // process.exit(1)

  return {
    json: transformedTemplate,
    yaml: yamlWithComments.trim(),
    yamlNoComments: yamlNoComments.trim(),
    comments: commentsData,
    resourcesInfo,
    resourcesNamePropertiesFound: foundPropNames,
    prompts: {
      resourceCosts: resourcesPrompt,
      resourceNames: prompt,
      iamSecurity: iamPrompt
    },
    originalContents: input,
    diff: {
      log: diffOutput,
      patch: patch,
      diff: diffJson
    },
  }
}

function sortObjectKeys(obj = {}) {
  return Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = obj[key]
    return acc
  }, {})
}

function colorizeDiffForLogging(diff) {
  return diff
    .split('\n')
    .slice(2) // Remove the diff header
    .filter(line => line.trim()) // Remove empty lines
    .map(line => {
      if (line.startsWith('+')) {
        return `\x1b[32m${line}\x1b[0m` // Green for additions
      }
      if (line.startsWith('-')) {
        return `\x1b[31m${line}\x1b[0m` // Red for deletions
      }
      if (line.startsWith('@')) {
        return `\x1b[36m${line}\x1b[0m` // Cyan for chunk headers
      }
      return line
    })
    .join('\n')
}

function prettyDiff(obj1, obj2) {
  const theDiff = jestDiff(obj1, obj2, {
    expand: false,
    contextLines: 0,
    color: false
  })
  return stripAnsi(theDiff
   .split('\n')
   .filter(line => !line.includes('@@') && !line.includes('diff --git'))
   .join('\n'))
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
    'Description',
    'AWSTemplateFormatVersion',
    'Transform',
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
      // Preserve arrays
      if (Array.isArray(template[key])) {
        sortedTemplate[key] = [...template[key]]
      } else {
        sortedTemplate[key] = template[key]
      }
    }
  })

  // // Sort resources if present
  // if (sortedTemplate.Resources) {
  //   for (const resourceKey in sortedTemplate.Resources) {
  //     const resource = sortedTemplate.Resources[resourceKey]
  //     // Skip if resource is an array
  //     if (Array.isArray(resource)) {
  //       continue
  //     }
      
  //     const sortedResource = {}
      
  //     // Add keys in specified order if they exist
  //     order.forEach(key => {
  //       if (resource[key] !== undefined) {
  //         sortedResource[key] = resource[key]
  //       }
  //     })

  //     // Add any remaining keys that weren't in our order list
  //     Object.keys(resource).forEach(key => {
  //       if (!order.includes(key)) {
  //         // Preserve arrays
  //         if (Array.isArray(resource[key])) {
  //           sortedResource[key] = [...resource[key]]
  //         } else {
  //           sortedResource[key] = resource[key]
  //         }
  //       }
  //     })
      
  //     sortedTemplate.Resources[resourceKey] = sortIAMPolicyProperties(sortedResource)
  //   }
  // }

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
  // Check if input is a URL
  try {
    const url = new URL(input)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http
        
        client.get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Failed to fetch URL: ${input} (${res.statusCode} ${res.statusMessage})`))
            return
          }

          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => resolve(data))
        }).on('error', err => {
          reject(new Error(`Failed to fetch URL: ${input} (${err.message})`))
        })
      })
    }
  } catch (err) {
    // Not a valid URL, continue with file handling
    if (err.code !== 'ERR_INVALID_URL') {
      throw err
    }
  }

  // Handle local files
  if (typeof input === 'string' && (input.endsWith('.yml') || input.endsWith('.yaml') || input.endsWith('.json'))) {
    return fs.readFile(input, 'utf8')
  }

  return input
}

function parseInput(input, options = {}) {
  if (typeof input === 'object') {
    return {
      template: input,
      originalYaml: dumpYaml(input)
    }
  }

  if (typeof input !== 'string') {
    throw new Error('Input must be an object or a string')
  }

  let template
  let originalYaml
  let parseErrors = []
  
  try {
    template = JSON.parse(input)
    // Convert JSON input to YAML format
    originalYaml = dumpYaml(template)
  } catch (e) {
    parseErrors.push(e)
    let cleanYml = input
    if (options.cleanCode) {
      cleanYml = input.replace(/^([ \t]*[A-Za-z0-9_-]+:) \|2\-$/gm, '$1 |-\n')
    }

    // Quote policy version to prevent date parsing
    cleanYml = cleanYml.replace(
      /^(\s*Version:\s*)(\d{4}-\d{2}-\d{2})$/gm,
      '$1"$2"'
    )

    const cfnSchema = getCfnYamlSchema()
    try {
      template = yaml.load(cleanYml, { schema: cfnSchema })
      originalYaml = input // For YAML input, use original string
    } catch (e) {
      parseErrors.push(e)
      try {
        template = yaml.load(input, { schema: cfnSchema })
        originalYaml = input
      } catch (e) {
        parseErrors.push(e)
        console.log('parseErrors', parseErrors)
        process.exit(1)
      }
    }
  }

  return {
    template,
    originalYaml
  }
}


function splitResourceType(resourceType) {
  console.log('resourceType', resourceType)
  const [vendor, service, type] = resourceType.split('::')
  return {
    vendor,
    service,
    type,
    name: service + type,
    resourceType
  }
}


function handleReplacement(pattern, replacement, logicalId, resource) {
  if (typeof replacement === 'string') {
    return logicalId.replace(pattern, replacement)
  } else if (replacement instanceof RegExp) {
    return logicalId.replace(pattern, replacement)
  } else if (typeof replacement === 'function') {
    const resourceDetails = splitResourceType(resource.Type)
    console.log('resourceDetails', resourceDetails)
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

// Update replaceLogicalIds to handle both cases
function replaceLogicalIds(template, options) {
  if (!template.Resources) return;

  const { postfixReplacements, pattern, replacement } = options;
  const logicalIds = getLogicalIds(template);
  console.log('logicalIds', logicalIds)
  // console.log('postfixReplacements', postfixReplacements)
  // process.exit(1)
  const replacements = {};
  const existingNames = new Set(logicalIds);
  const proposedNames = new Map();

  // First pass: identify resources to rename
  for (const logicalId of logicalIds) {
    let newLogicalId = logicalId;
    // console.log('logicalId', logicalId, pattern, replacement)
    if (postfixReplacements) {
      // Handle random string replacements
      for (const [postfixPattern, postfixReplacement] of postfixReplacements) {
        // console.log('postfixPattern', postfixPattern)
        // console.log('postfixReplacement', postfixReplacement)
        newLogicalId = newLogicalId.replace(postfixPattern, postfixReplacement);
      }
    } else if (pattern) {
      console.log('pattern', logicalId)
      // Handle user-specified replacements
      newLogicalId = handleReplacement(pattern, replacement, newLogicalId, template.Resources[logicalId]);
    }
    console.log('newLogicalId', newLogicalId)

    if (newLogicalId && newLogicalId !== logicalId) {
      // Check for collisions
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
