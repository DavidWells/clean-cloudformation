const { processTemplate } = require('./src/process')
const fs = require('fs').promises

async function run() {
  const result = await processTemplate(
    // {
    //   url: 'https://raw.githubusercontent.com/panacloud-modern-global-apps/full-stack-serverless-cdk/798c98300b89cfb5eac6004cd348fa60d05f813b/step16_simple_email_service/python/sending_email_using%20_ses_lambdaa/cdk.out/PythonStack.template.json',
    //   name: 'simple_email_service'
    // },
    // {
    //   url: 'https://raw.githubusercontent.com/mattymoomoo/aws-power-tuner-ui/4fbb6cf506aa6e0781f121818e8933ef9ce6794d/cdk/template.yml',
    //   name: 'aws-power-tuner-ui'
    // },
    // {
    //   url: 'https://raw.githubusercontent.com/kknd4eva/SohWithEventBridge/refs/heads/master/SohWithEventBridge/serverless.yaml',
    //   name: 'SohWithEventBridge'
    // },
    // {
    //   url: 'https://raw.githubusercontent.com/aweigold/tachyon/95f8f25ad1bd1729c86aac3276510bd1695306dc/cloudformation-template.json',
    //   name: 'Tachyon'
    // },
    // {
    //   url: 'https://raw.githubusercontent.com/JohnMadhan07/EWD-Ass1/f2a5aee6993a4ab0785d7f0158a5f8f46fd77099/cdk.out/AuthAppStack.template.json',
    //   name: 'AuthAppStack'
    // },
    // {
    //   url: 'https://raw.githubusercontent.com/nguyentrungduc134/Amazon-S3-multipart-API/04a3d4f897aeaebb82bfcc7c6cd884a665ded6e2/cdk.out/MultipartS3UploadStack.template.json',
    //   name: 'MultipartS3UploadStack'
    // },
    //'https://raw.githubusercontent.com/kknd4eva/SohWithEventBridge/refs/heads/master/SohWithEventBridge/serverless.yaml',
    //'https://raw.githubusercontent.com/zoph-io/serverless-aws-https-webredirect/6c99fef9218c47f80bacb1236c8f5d964834ef8b/template.yml',
    // './tests/fixtures/broken.yml',
    //'./tests/fixtures/inline-function.yml',
    // './tests/fixtures/tiny-two.yml'
    // './tests/fixtures/serverless.yml',
    // './tests/fixtures/serverless-refs.yml',
    //'./tests/fixtures/stack-one.json',
    // './tests/fixtures/stack-one-yaml.yml',
    './tests/fixtures/stack-two.json',
    // './tests/fixtures/stack-two-yml.yml',
    // './tests/fixtures/tiny.yml',
    //'./tests/fixtures/stack-three.json',
    // './tests/fixtures/stack-four.json',
    // './tests/fixtures/cdn-cloudformation.json'
  ).catch(err => {
    console.error('Error:', err)
    process.exit(1)
  })

  console.log(result)
  console.log(Object.keys(result))

  // Write results to example.json
  await fs.writeFile(
    'example.json',
    JSON.stringify(result, null, 2),
    'utf8'
  ).catch(err => {
    console.error('Error writing example.json:', err)
    process.exit(1)
  })
}

run()
