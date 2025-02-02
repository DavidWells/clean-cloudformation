# CloudFormation Template Cleaner

A tool to clean and format AWS CloudFormation templates, making them more readable and maintainable.

Handy for reducing size of templates and ejecting from CDK.

## Features

- Removes CDK-specific elements and metadata
- Formats YAML with consistent indentation and spacing
- Validates resources against AWS CloudFormation schemas
- Identifies resources that need better naming
- Converts long-form syntax to short-form where appropriate
- Sorts template sections in a logical order
- Folds arrays into single lines when appropriate
- Maintains proper YAML formatting
- Outputs AI prompts to help you clean the template

## Installation

```
npm install
```

## Usage

```
node example.js
```

## Other utils

- https://github.com/stackql/aws-cfn-schema-to-openapi/tree/main