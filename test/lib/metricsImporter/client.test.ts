import request from '@cypress/request';
import {
  MetricsImporterClient,
  metricsImporterClientFromCoroner,
} from '../../../lib/metricsImporter/client';

jest.mock('@cypress/request');
const mockedRequest = request as jest.Mocked<typeof request>;

describe('MetricsImporterClient', () => {
  let client: MetricsImporterClient;
  const mockUrl = 'https://metrics.example.com';
  const mockCoronerLocation = 'https://coroner.example.com';
  const mockCoronerToken = 'test-token-123';

  beforeEach(() => {
    jest.clearAllMocks();
    client = new MetricsImporterClient(
      mockUrl,
      mockCoronerLocation,
      mockCoronerToken,
    );
  });

  describe('request', () => {
    it('should make a request with proper headers', async () => {
      const mockResponse = {data: 'test'};

      mockedRequest.mockImplementation((options, callback) => {
        expect(options).toMatchObject({
          url: `${mockUrl}/test/path`,
          method: 'GET',
          headers: {
            'X-Coroner-Location': mockCoronerLocation,
            'X-Coroner-Token': mockCoronerToken,
          },
          qs: {param: 'value'},
          json: true,
        });
        callback(null, {statusCode: 200}, mockResponse);
      });

      const result = await client.request('get', '/test/path', null, {
        param: 'value',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle POST requests with body', async () => {
      const mockBody = {key: 'value'};
      const mockResponse = {success: true};

      mockedRequest.mockImplementation((options, callback) => {
        expect(options).toMatchObject({
          url: `${mockUrl}/create`,
          method: 'POST',
          body: mockBody,
          headers: {
            'X-Coroner-Location': mockCoronerLocation,
            'X-Coroner-Token': mockCoronerToken,
          },
          json: true,
        });
        callback(null, {statusCode: 201}, mockResponse);
      });

      const result = await client.request('post', '/create', mockBody);
      expect(result).toEqual(mockResponse);
    });

    it('should reject on request error', async () => {
      const mockError = new Error('Network error');

      mockedRequest.mockImplementation((options, callback) => {
        callback(mockError, null, null);
      });

      await expect(client.request('get', '/test')).rejects.toEqual(mockError);
    });

    it('should reject on HTTP error status', async () => {
      mockedRequest.mockImplementation((options, callback) => {
        callback(null, {statusCode: 404}, {error: {message: 'Not found'}});
      });

      await expect(client.request('get', '/test')).rejects.toBe(
        'HTTP status 404: Not found',
      );
    });

    it('should reject with generic message on HTTP error without error body', async () => {
      mockedRequest.mockImplementation((options, callback) => {
        callback(null, {statusCode: 500}, null);
      });

      await expect(client.request('get', '/test')).rejects.toBe(
        'HTTP status 500',
      );
    });
  });

  describe('checkSource', () => {
    it('should check a source with proper parameters', async () => {
      const mockResponse = {valid: true};
      const params = {
        project: 'test-project',
        sourceId: 'source-123',
        query: 'SELECT * FROM metrics',
      };

      mockedRequest.mockImplementation((options, callback) => {
        expect(options.url).toBe(
          `${mockUrl}/projects/test-project/sources/source-123/check`,
        );
        expect(options.qs).toEqual({query: params.query});
        callback(null, {statusCode: 200}, mockResponse);
      });

      const result = await client.checkSource(params);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('createImporter', () => {
    it('should create an importer with all parameters', async () => {
      const mockResponse = {id: 'importer-123'};
      const params = {
        project: 'test-project',
        sourceId: 'source-123',
        name: 'Test Importer',
        query: 'SELECT * FROM metrics',
        metric: 'cpu_usage',
        metricGroup: 'system',
        startAt: '2023-01-01T00:00:00Z',
        delay: 3600,
        enabled: true,
      };

      mockedRequest.mockImplementation((options, callback) => {
        expect(options.url).toBe(`${mockUrl}/projects/test-project/importers`);
        expect(options.method).toBe('POST');
        expect(options.body).toEqual(params);
        callback(null, {statusCode: 201}, mockResponse);
      });

      const result = await client.createImporter(params);
      expect(result).toEqual(mockResponse);
    });

    it('should create an importer with enabled defaulting to true', async () => {
      const mockResponse = {id: 'importer-123'};
      const params = {
        project: 'test-project',
        sourceId: 'source-123',
        name: 'Test Importer',
        query: 'SELECT * FROM metrics',
        metric: 'cpu_usage',
        metricGroup: 'system',
        startAt: '2023-01-01T00:00:00Z',
        delay: 3600,
      };

      mockedRequest.mockImplementation((options, callback) => {
        expect(options.body.enabled).toBe(true);
        callback(null, {statusCode: 201}, mockResponse);
      });

      await client.createImporter(params);
    });
  });

  describe('logs', () => {
    it('should fetch logs with default limit', async () => {
      const mockResponse = {logs: []};
      const params = {
        project: 'test-project',
      };

      mockedRequest.mockImplementation((options, callback) => {
        expect(options.url).toBe(`${mockUrl}/projects/test-project/logs`);
        expect(options.qs).toEqual({limit: 1000});
        callback(null, {statusCode: 200}, mockResponse);
      });

      const result = await client.logs(params);
      expect(result).toEqual(mockResponse);
    });

    it('should fetch logs with custom parameters', async () => {
      const mockResponse = {logs: []};
      const params = {
        project: 'test-project',
        sourceId: 'source-123',
        importerId: 'importer-456',
        limit: 500,
      };

      mockedRequest.mockImplementation((options, callback) => {
        expect(options.url).toBe(`${mockUrl}/projects/test-project/logs`);
        expect(options.qs).toEqual({
          limit: 500,
          sourceId: 'source-123',
          importerId: 'importer-456',
        });
        callback(null, {statusCode: 200}, mockResponse);
      });

      const result = await client.logs(params);
      expect(result).toEqual(mockResponse);
    });
  });
});

describe('metricsImporterClientFromCoroner', () => {
  it('should create a MetricsImporterClient from CoronerClient', async () => {
    const mockCoronerClient = {
      endpoint: 'https://coroner.example.com',
      config: {token: 'coroner-token'},
      find_service: jest
        .fn()
        .mockResolvedValue('https://metrics-service.example.com'),
    };

    const client = await metricsImporterClientFromCoroner(mockCoronerClient);

    expect(mockCoronerClient.find_service).toHaveBeenCalledWith(
      'metrics-importer',
    );
    expect(client).toBeInstanceOf(MetricsImporterClient);
    expect(client.url).toBe('https://metrics-service.example.com');
    expect(client.coronerLocation).toBe('https://coroner.example.com');
    expect(client.coronerToken).toBe('coroner-token');
  });
});
