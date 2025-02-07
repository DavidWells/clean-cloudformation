/**
 * Get the value from an intrinsic function, handling both original (Fn::) and transformed (Ref::) formats
 * @param {Object} obj - Object containing the intrinsic function
 * @param {string} fnName - Name of the function without prefix (e.g. 'Sub', 'Join', 'GetAtt')
 * @returns {any} The value of the intrinsic function or undefined if not found
 */
function getIntrinsicValue(obj, fnName) {
  if (!obj || typeof obj !== 'object') return undefined
  
  const originalKey = `Fn::${fnName}`
  const transformedKey = `Ref::${fnName}`
  
  return obj[originalKey] || obj[transformedKey] || obj[fnName]
}

module.exports = {
  getIntrinsicValue
}