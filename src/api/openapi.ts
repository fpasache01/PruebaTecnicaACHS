export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'ACHS Benefit API',
    version: '1.0.0',
    description: 'HTTP API for calculating economic benefits using dynamic PostgreSQL formula rules.',
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': {
            description: 'The API is running.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: {
                    status: { type: 'string', example: 'ok' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/benefits/calculate': {
      post: {
        summary: 'Calculate a benefit',
        description: 'Calculates a benefit using saved enabled formula rules ordered by priority.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BenefitCalculationRequest' },
              examples: {
                partialWithDependents: {
                  value: {
                    sbm: 1000000,
                    grado: 45,
                    granInvalidez: false,
                    beneficiaryType: 'WORKER',
                    beneficiary: { cargas: 2 },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Benefit calculation result.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BenefitCalculationResult' },
              },
            },
          },
          '400': {
            description: 'Validation error.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/benefits/rules': {
      get: {
        summary: 'List formula rules',
        responses: {
          '200': {
            description: 'Saved formula rules sorted by priority.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/BenefitFormulaRule' },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Add a formula rule',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NewBenefitFormulaRule' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Saved formula rule.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BenefitFormulaRule' },
              },
            },
          },
          '400': {
            description: 'Validation error.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/benefits/rules/{id}': {
      delete: {
        summary: 'Delete a formula rule',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '204': { description: 'Formula rule deleted.' },
          '404': {
            description: 'Formula rule not found.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/benefits/formula-variables': {
      get: {
        summary: 'List formula variables',
        responses: {
          '200': {
            description: 'Configured formula variables.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/FormulaVariable' },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create or enable a formula variable',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/FormulaVariable' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Formula variable created.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FormulaVariable' },
              },
            },
          },
          '200': {
            description: 'Formula variable updated or enabled.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FormulaVariable' },
              },
            },
          },
          '400': {
            description: 'Validation error.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        summary: 'OpenAPI document',
        responses: {
          '200': {
            description: 'OpenAPI 3 document for this API.',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      BenefitCalculationRequest: {
        type: 'object',
        required: ['sbm', 'grado'],
        properties: {
          sbm: { type: 'number', minimum: 0, example: 1000000 },
          grado: { type: 'number', minimum: 0, maximum: 100, example: 45 },
          granInvalidez: { type: 'boolean', example: false },
          beneficiaryType: { type: 'string', example: 'WORKER' },
          beneficiary: {
            type: 'object',
            additionalProperties: true,
            example: { cargas: 2 },
          },
        },
      },
      BenefitCalculationResult: {
        type: 'object',
        required: ['tipoBeneficio', 'monto', 'periodicidad'],
        properties: {
          tipoBeneficio: {
            type: 'string',
            enum: ['INDEMNIZACION', 'PENSION_PARCIAL', 'PENSION_TOTAL', 'NINGUNO'],
          },
          monto: { type: 'number', example: 370000 },
          periodicidad: {
            type: 'string',
            nullable: true,
            enum: ['UNICO', 'MENSUAL'],
            example: 'MENSUAL',
          },
        },
      },
      NewBenefitFormulaRule: {
        type: 'object',
        required: [
          'formulaName',
          'priority',
          'formula',
          'enabled',
          'beneficiaryType',
          'periodicity',
          'benefitType',
          'conditions',
        ],
        properties: {
          formulaName: { type: 'string', example: 'Partial pension with dependent supplement' },
          priority: { type: 'number', example: 150 },
          formula: { type: 'string', example: 'sbm * 0.35 + cargas * 10000' },
          enabled: { type: 'boolean', example: true },
          beneficiaryType: { type: 'string', example: 'WORKER' },
          periodicity: {
            type: 'string',
            nullable: true,
            enum: ['UNICO', 'MENSUAL'],
            example: 'MENSUAL',
          },
          benefitType: {
            type: 'string',
            enum: ['INDEMNIZACION', 'PENSION_PARCIAL', 'PENSION_TOTAL', 'NINGUNO'],
          },
          conditions: { $ref: '#/components/schemas/BenefitFormulaConditions' },
        },
      },
      BenefitFormulaRule: {
        allOf: [
          {
            type: 'object',
            required: ['id'],
            properties: {
              id: {
                type: 'string',
                example: '71c4f1cc-4db5-41ab-ae9e-9e65052bbf4b',
              },
            },
          },
          { $ref: '#/components/schemas/NewBenefitFormulaRule' },
        ],
      },
      BenefitFormulaConditions: {
        type: 'object',
        properties: {
          gradoMin: { type: 'number', minimum: 0, maximum: 100, example: 40 },
          gradoMaxExclusive: { type: 'number', minimum: 0, maximum: 100, example: 70 },
          granInvalidez: { type: 'boolean', example: true },
        },
      },
      FormulaVariable: {
        type: 'object',
        required: ['variableName', 'dataType', 'source', 'enabled'],
        properties: {
          variableName: { type: 'string', example: 'cargas' },
          dataType: {
            type: 'string',
            enum: ['numeric', 'boolean', 'text'],
            example: 'numeric',
          },
          source: { type: 'string', example: 'beneficiary.cargas' },
          enabled: { type: 'boolean', example: true },
          description: {
            type: 'string',
            example: 'Number of beneficiary dependents',
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'formula references unknown variable: cargas' },
            },
          },
        },
      },
    },
  },
} as const;
