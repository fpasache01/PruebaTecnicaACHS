import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import swaggerUi from 'swagger-ui-express';
import { calcularBeneficio } from '../domain/benefit/benefit_engine.js';
import { openApiDocument } from './openapi.js';

interface BenefitCalculationBody {
  sbm?: unknown;
  grado?: unknown;
  granInvalidez?: unknown;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());

  app.get('/health', (_request: Request, response: Response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.get('/openapi.json', (_request: Request, response: Response) => {
    response.status(200).json(openApiDocument);
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.post('/api/benefits/calculate', (request: Request, response: Response, next: NextFunction) => {
    try {
      const body = parseBenefitCalculationBody(request.body as BenefitCalculationBody);
      const result = calcularBeneficio(body.sbm, body.grado, {
        granInvalidez: body.granInvalidez,
      });

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

  return {
    sbm: body.sbm,
    grado: body.grado,
    granInvalidez: body.granInvalidez,
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
