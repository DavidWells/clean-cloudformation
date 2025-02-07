function isEmptyObject(obj) {
  if (typeof obj !== 'object' || obj === null) return false
  return Object.keys(obj).length === 0
}

function removeEmptyObjects(template) {
  if (isEmptyObject(template.Resources)) {
    delete template.Resources
  }
  if (isEmptyObject(template.Conditions)) {
    delete template.Conditions
  }
  if (isEmptyObject(template.Outputs)) {
    delete template.Outputs
  }
  if (isEmptyObject(template.Parameters)) {
    delete template.Parameters
  }
  if (isEmptyObject(template.Metadata)) {
    delete template.Metadata
  }
}

module.exports = removeEmptyObjects