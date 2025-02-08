const fs = require('fs').promises
const path = require('path')
const assert = require('uvu/assert')
const { createPatch } = require('diff')
const stripAnsi = require('strip-ansi')
const jestDiff = require('jest-diff').diff

// Helper to read fixture files
async function readFixture(name) {
  const fixturePath = path.join(__dirname, 'fixtures', name)
  return fs.readFile(fixturePath, 'utf8')
}

// Helper to handle snapshots
async function matchSnapshot(name, content) {
  const snapshotDir = path.join(__dirname, '__snapshots__')
  const snapshotPath = path.join(snapshotDir, `${name}.snap`)

  // Ensure snapshot directory exists
  await fs.mkdir(snapshotDir, { recursive: true })

  // Check if we should update snapshots
  if (process.env.UPDATE_SNAPSHOTS === 'true') {
    await fs.writeFile(snapshotPath, content)
    console.log(`Updated snapshot: ${name}`)
    return
  }

  try {
    const existing = await fs.readFile(snapshotPath, 'utf8')
    // Add diffing here
    if (content !== existing) {
      // Use jest-diff for better formatting
      const prettyDiff = jestDiff(existing, content, {
        aAnnotation: 'Snapshot',
        bAnnotation: 'Received',
        expand: false
      })

      console.error('\nSnapshot comparison failed for:', name)
      console.error('\nDiff:')
      console.error(prettyDiff)
      console.log(`Failure in snapshot test "${name}"`)
      process.exit(1)
    }

    assert.fixture(content, existing)
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Create new snapshot if it doesn't exist
      await fs.writeFile(snapshotPath, content)
      console.log(`Created new snapshot: ${name}`)
    } else {
      throw err
    }
  }
}

module.exports = {
  readFixture,
  matchSnapshot
} 