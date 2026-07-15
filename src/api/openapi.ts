export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'ACHS Benefit API',
    version: '1.0.0',
    description: 'HTTP API for calculating economic benefits using the ACHS benefit engine.',
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
                    status: {
                      type: 'string',
                      example: 'ok',
                    },
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
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/BenefitCalculationRequest',
              },
              examples: {
                totalWithGranInvalidez: {
                  value: {
                    sbm: 1000000,
                    grado: 70,
                    granInvalidez: true,
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
                schema: {
                  $ref: '#/components/schemas/BenefitCalculationResult',
                },
              },
            },
          },
          '400': {
            description: 'Validation error.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
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
                schema: {
                  type: 'object',
                },
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
          sbm: {
            type: 'number',
            minimum: 0,
            example: 1000000,
          },
          grado: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            example: 70,
          },
          granInvalidez: {
            type: 'boolean',
            example: true,
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
          monto: {
            type: 'number',
            example: 1000000,
          },
          periodicidad: {
            type: 'string',
            nullable: true,
            enum: ['UNICO', 'MENSUAL'],
            example: 'MENSUAL',
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
              code: {
                type: 'string',
                example: 'VALIDATION_ERROR',
              },
              message: {
                type: 'string',
                example: 'grado must be between 0 and 100',
              },
            },
          },
        },
      },
    },
  },
} as const;
