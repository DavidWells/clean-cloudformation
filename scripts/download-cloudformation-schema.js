const https = require('https');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const SCHEMA_URL = 'https://schema.cloudformation.us-east-1.amazonaws.com/CloudformationSchema.zip';
const DOWNLOAD_PATH = path.join(__dirname, '..', 'CloudformationSchema.zip');
const EXTRACT_PATH = path.join(__dirname, '..', 'schemas');
const META_PATH = path.join(EXTRACT_PATH, '_meta.json');

// Check if we need to download new schemas
if (fs.existsSync(META_PATH)) {
  const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  const lastDownload = new Date(meta.timestamp);
  const now = new Date();
  const hoursSinceDownload = (now - lastDownload) / (1000 * 60 * 60);

  if (hoursSinceDownload < 24) {
    console.log(`Schema files are up to date (downloaded ${Math.floor(hoursSinceDownload)} hours ago)`);
    process.exit(0);
  }
}

// Remove existing schemas directory if it exists
if (fs.existsSync(EXTRACT_PATH)) {
  fs.rmSync(EXTRACT_PATH, { recursive: true });
  console.log('Removed existing schemas directory');
}

// Create fresh schemas directory
fs.mkdirSync(EXTRACT_PATH, { recursive: true });

console.log('Downloading CloudFormation schema...');

function updateSchemaContents(content = '') {
  // return content
  const replacements = [
    [/"type"\s*:\s*\[\s*"string"\s*,\s*"object"\s*\]/, '"type": "object"'],
    [/"type"\s*:\s*\[\s*"object"\s*,\s*"string"\s*\]/, '"type": "object"'],
    [/"type"\s*:\s*\[\s*"boolean"\s*,\s*"string"\s*\]/, '"type": "boolean"'],
    [/"type"\s*:\s*\[\s*"string"\s*,\s*"array"\s*\]/, '"type": "array"'],
    [/"type"\s*:\s*\[\s*"integer"\s*,\s*"string"\s*\]/, '"type": "integer"'],
    [/"type"\s*:\s*\[\s*"number"\s*,\s*"string"\s*\]/, '"type": "number"'],
    [/"type"\s*:\s*\[\s*"boolean"\s*,\s*"null"\s*\]/, '"type": "boolean"']
  ]
  for (const [pattern, replacement] of replacements) {
    content = content.replace(new RegExp(pattern, 'g'), replacement)
  }
  return content
}

// Download the schema file
const file = fs.createWriteStream(DOWNLOAD_PATH);
https.get(SCHEMA_URL, (response) => {
  response.pipe(file);

  file.on('finish', () => {
    file.close();
    console.log('Download complete. Extracting...');

    // Extract the zip file
    try {
      const zip = new AdmZip(DOWNLOAD_PATH);
      zip.extractAllTo(EXTRACT_PATH, true);
      console.log(`Successfully extracted schema to ${EXTRACT_PATH}`);

      // Clean up the zip file
      fs.unlinkSync(DOWNLOAD_PATH);
      console.log('Cleaned up temporary files');

      // Process and rename files based on their typeName
      console.log('Processing and renaming schema files...');
      const files = fs.readdirSync(EXTRACT_PATH);
      
      files.forEach(file => {
        const filePath = path.join(EXTRACT_PATH, file);
        try {
          let content = fs.readFileSync(filePath, 'utf8');
          content = updateSchemaContents(content);
          const schema = JSON.parse(content);
          
          if (schema.typeName) {
            const newName = schema.typeName + '.json';
            const newPath = path.join(EXTRACT_PATH, newName);
            
            // Write updated content to new file
            fs.writeFileSync(newPath, JSON.stringify(schema, null, 2));
            
            // Remove original file if it's different from the new path
            if (filePath !== newPath) {
              fs.unlinkSync(filePath);
              console.log(`Processed and renamed ${file} to ${newName}`);
            }
          }
        } catch (err) {
          console.warn(`Warning: Could not process ${file}: ${err.message}`);
        }
      });

      // Write meta file with timestamp
      fs.writeFileSync(META_PATH, JSON.stringify({
        timestamp: new Date().toISOString()
      }, null, 2));

      console.log('Schema processing complete!');

    } catch (err) {
      console.error('Error extracting schema:', err);
      process.exit(1);
    }
  });
}).on('error', (err) => {
  fs.unlinkSync(DOWNLOAD_PATH);
  console.error('Error downloading schema:', err);
  process.exit(1);
}); 