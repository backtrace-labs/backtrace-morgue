import axios from 'axios';
import {
  MetricsImporterClient,
  metricsImporterClientFromCoroner,
} from '../../../lib/metricsImporter/client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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

      mockedAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      const result = await client.request('get', '/test/path', null, {
        param: 'value',
      });
      expect(result).toEqual(mockResponse);

      expect(mockedAxios).toHaveBeenCalledWith({
        url: `${mockUrl}/test/path`,
        method: 'GET',
        headers: {
          'X-Coroner-Location': mockCoronerLocation,
          'X-Coroner-Token': mockCoronerToken,
        },
        params: {param: 'value'},
        data: null,
      });
    });

    it('should handle POST requests with body', async () => {
      const mockBody = {key: 'value'};
      const mockResponse = {success: true};

      mockedAxios.mockResolvedValue({
        status: 201,
        statusText: 'Created',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      const result = await client.request('post', '/create', mockBody);
      expect(result).toEqual(mockResponse);

      expect(mockedAxios).toHaveBeenCalledWith({
        url: `${mockUrl}/create`,
        method: 'POST',
        data: mockBody,
        headers: {
          'X-Coroner-Location': mockCoronerLocation,
          'X-Coroner-Token': mockCoronerToken,
        },
        params: {},
      });
    });

    it('should reject on request error', async () => {
      const mockError = new Error('Network error');

      mockedAxios.mockRejectedValue(mockError);

      await expect(client.request('get', '/test')).rejects.toEqual(mockError);
    });

    it('should reject on HTTP error status', async () => {
      mockedAxios.mockRejectedValue({
        response: {
          status: 404,
          statusText: 'Not Found',
          headers: {},
          data: {error: {message: 'Not found'}},
        },
      });

      await expect(client.request('get', '/test')).rejects.toThrow(
        'HTTP status 404: Not found',
      );
    });

    it('should reject with generic message on HTTP error without error body', async () => {
      mockedAxios.mockRejectedValue({
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          headers: {},
          data: null,
        },
      });

      await expect(client.request('get', '/test')).rejects.toThrow(
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

      mockedAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      const result = await client.checkSource(params);
      expect(result).toEqual(mockResponse);

      expect(mockedAxios).toHaveBeenCalledWith({
        url: `${mockUrl}/projects/test-project/sources/source-123/check`,
        method: 'GET',
        params: {query: params.query},
        data: null,
        headers: expect.any(Object),
      });
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

      mockedAxios.mockResolvedValue({
        status: 201,
        statusText: 'Created',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      const result = await client.createImporter(params);
      expect(result).toEqual(mockResponse);

      expect(mockedAxios).toHaveBeenCalledWith({
        url: `${mockUrl}/projects/test-project/importers`,
        method: 'POST',
        data: expect.objectContaining(params),
        params: {},
        headers: expect.any(Object),
      });
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

      mockedAxios.mockResolvedValue({
        status: 201,
        statusText: 'Created',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      await client.createImporter(params);

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({enabled: true}),
        }),
      );
    });
  });

  describe('logs', () => {
    it('should fetch logs with default limit', async () => {
      const mockResponse = {logs: []};
      const params = {
        project: 'test-project',
      };

      mockedAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      const result = await client.logs(params);
      expect(result).toEqual(mockResponse);

      expect(mockedAxios).toHaveBeenCalledWith({
        url: `${mockUrl}/projects/test-project/logs`,
        method: 'GET',
        params: {limit: 1000},
        data: null,
        headers: expect.any(Object),
      });
    });

    it('should fetch logs with custom parameters', async () => {
      const mockResponse = {logs: []};
      const params = {
        project: 'test-project',
        sourceId: 'source-123',
        importerId: 'importer-456',
        limit: 500,
      };

      mockedAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      const result = await client.logs(params);
      expect(result).toEqual(mockResponse);

      expect(mockedAxios).toHaveBeenCalledWith({
        url: `${mockUrl}/projects/test-project/logs`,
        method: 'GET',
        params: {
          limit: 500,
          sourceId: 'source-123',
          importerId: 'importer-456',
        },
        data: null,
        headers: expect.any(Object),
      });
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
