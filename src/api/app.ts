import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import swaggerUi from 'swagger-ui-express';
import { calcularBeneficioConReglas } from '../domain/benefit/benefit_engine.js';
import {
  parseFormulaVariable,
  parseNewBenefitFormulaRule,
} from '../domain/benefit/benefit_rules.js';
import {
  PostgresBenefitFormulaRepository,
  type BenefitFormulaRepository,
  type FormulaVariableRepository,
} from './benefit_formula_repository.js';
import { openApiDocument } from './openapi.js';

interface BenefitCalculationBody {
  sbm?: unknown;
  grado?: unknown;
  granInvalidez?: unknown;
  beneficiaryType?: unknown;
  beneficiary?: unknown;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

interface CreateAppOptions {
  formulaRepository?: BenefitFormulaRepository;
  variableRepository?: FormulaVariableRepository;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  const fallbackRepository = options.formulaRepository !== undefined && options.variableRepository !== undefined
    ? undefined
    : new PostgresBenefitFormulaRepository();
  const formulaRepository = options.formulaRepository ?? fallbackRepository!;
  const variableRepository = options.variableRepository ?? fallbackRepository!;

  app.use(express.json());

  app.get('/health', (_request: Request, response: Response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.get('/openapi.json', (_request: Request, response: Response) => {
    response.status(200).json(openApiDocument);
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.get('/api/benefits/rules', async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const rules = await formulaRepository.listRules();

      response.status(200).json(rules);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/benefits/rules', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const variables = await variableRepository.listVariables();
      const rule = parseNewBenefitFormulaRule(request.body, variables);
      const savedRule = await formulaRepository.addRule(rule);

      response.status(201).json(savedRule);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/benefits/rules/:id', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const deleted = await formulaRepository.deleteRule(request.params.id);

      if (!deleted) {
        response.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: `formula rule not found: ${request.params.id}`,
          },
        });
        return;
      }

      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/benefits/formula-variables', async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const variables = await variableRepository.listVariables();

      response.status(200).json(variables);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/benefits/formula-variables', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const variable = parseFormulaVariable(request.body);
      const existingVariables = await variableRepository.listVariables();
      const exists = existingVariables.some(
        (candidate) => candidate.variableName === variable.variableName,
      );
      const savedVariable = await variableRepository.upsertVariable(variable);

      response.status(exists ? 200 : 201).json(savedVariable);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/benefits/calculate', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const body = parseBenefitCalculationBody(request.body as BenefitCalculationBody);
      const rules = await formulaRepository.listRules();
      const variables = await variableRepository.listVariables();
      const result = calcularBeneficioConReglas({
        sbm: body.sbm,
        grado: body.grado,
        granInvalidez: body.granInvalidez,
        beneficiaryType: body.beneficiaryType,
        beneficiary: body.beneficiary,
      }, rules, variables);

      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);

  return app;
}

export const app = createApp();

function parseBenefitCalculationBody(body: BenefitCalculationBody): {
  sbm: number;
  grado: number;
  granInvalidez?: boolean;
  beneficiaryType?: string;
  beneficiary?: Record<string, unknown>;
} {
  if (body === null || typeof body !== 'object') {
    throw new ValidationError('request body must be a JSON object');
  }

  if (!Object.hasOwn(body, 'sbm')) {
    throw new ValidationError('sbm is required');
  }

  if (!Object.hasOwn(body, 'grado')) {
    throw new ValidationError('grado is required');
  }

  if (typeof body.sbm !== 'number') {
    throw new ValidationError('sbm must be a number');
  }

  if (typeof body.grado !== 'number') {
    throw new ValidationError('grado must be a number');
  }

  if (body.granInvalidez !== undefined && typeof body.granInvalidez !== 'boolean') {
    throw new ValidationError('granInvalidez must be a boolean');
  }

  if (body.beneficiaryType !== undefined && typeof body.beneficiaryType !== 'string') {
    throw new ValidationError('beneficiaryType must be a string');
  }

  if (
    body.beneficiary !== undefined
    && (body.beneficiary === null || typeof body.beneficiary !== 'object' || Array.isArray(body.beneficiary))
  ) {
    throw new ValidationError('beneficiary must be an object');
  }

  return {
    sbm: body.sbm,
    grado: body.grado,
    granInvalidez: body.granInvalidez,
    beneficiaryType: body.beneficiaryType,
    beneficiary: body.beneficiary as Record<string, unknown> | undefined,
  };
}

function errorHandler(
  error: Parameters<ErrorRequestHandler>[0],
  _request: Parameters<ErrorRequestHandler>[1],
  response: Parameters<ErrorRequestHandler>[2],
  _next: Parameters<ErrorRequestHandler>[3],
): void {
  if (isJsonSyntaxError(error)) {
    response.status(400).json(validationErrorResponse('request body must be valid JSON'));
    return;
  }

  if (error instanceof ValidationError || error instanceof RangeError) {
    response.status(400).json(validationErrorResponse(error.message));
    return;
  }

  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'unexpected error',
    },
  });
}

function validationErrorResponse(message: string): {
  error: {
    code: 'VALIDATION_ERROR';
    message: string;
  };
} {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message,
    },
  };
}

function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError
    && typeof error === 'object'
    && error !== null
    && 'status' in error
    && error.status === 400
    && 'body' in error;
}
