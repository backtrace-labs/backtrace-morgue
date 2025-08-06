import axios from 'axios';
import {BaseServiceClient} from '../../lib/baseServiceClient';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BaseServiceClient', () => {
  let client: BaseServiceClient;
  const mockUrl = 'https://service.example.com';
  const mockCoronerLocation = 'https://coroner.example.com';
  const mockCoronerToken = 'test-token-123';

  beforeEach(() => {
    jest.clearAllMocks();
    client = new BaseServiceClient(
      mockUrl,
      mockCoronerLocation,
      mockCoronerToken,
      false,
    );
  });

  describe('constructor', () => {
    it('should initialize with provided parameters', () => {
      expect(client.url).toBe(mockUrl);
      expect(client.coronerLocation).toBe(mockCoronerLocation);
      expect(client.coronerToken).toBe(mockCoronerToken);
      expect(client.insecure).toBe(false);
      expect(client.defaultQs).toEqual({});
    });

    it('should handle insecure mode', () => {
      const insecureClient = new BaseServiceClient(
        mockUrl,
        mockCoronerLocation,
        mockCoronerToken,
        true,
      );
      expect(insecureClient.insecure).toBe(true);
    });
  });

  describe('setDefaultQs', () => {
    it('should set default query string parameters', () => {
      const defaultParams = {universe: 'test', project: 'demo'};
      client.setDefaultQs(defaultParams);
      expect(client.defaultQs).toEqual(defaultParams);
    });
  });

  describe('request', () => {
    it('should make a GET request with proper configuration', async () => {
      const mockResponse = {data: 'test'};

      mockedAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      // We need to check the call parameters after the request
      const result = await client.request({
        method: 'get',
        path: '/api/test',
        qs: {param: 'value'},
      });

      expect(mockedAxios).toHaveBeenCalledWith({
        url: `${mockUrl}/api/test`,
        method: 'GET',
        headers: {
          'X-Coroner-Location': mockCoronerLocation,
          'X-Coroner-Token': mockCoronerToken,
        },
        params: {param: 'value'},
        data: null,
        httpsAgent: undefined,
        decompress: false,
      });

      expect(result).toEqual(mockResponse);
    });

    it('should include default query parameters', async () => {
      client.setDefaultQs({universe: 'test', project: 'demo'});
      const mockResponse = {data: 'test'};

      mockedAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      await client.request({
        method: 'get',
        path: '/api/test',
        qs: {param: 'value'},
      });

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {
            universe: 'test',
            project: 'demo',
            param: 'value',
          },
        }),
      );
    });

    it('should filter out undefined and null query parameters', async () => {
      const mockResponse = {data: 'test'};

      mockedAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      await client.request({
        method: 'get',
        path: '/api/test',
        qs: {
          valid: 'value',
          undefined: undefined,
          null: null,
        },
      });

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {valid: 'value'},
        }),
      );
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

      const result = await client.request({
        method: 'post',
        path: '/api/create',
        body: mockBody,
      });
      expect(result).toEqual(mockResponse);

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: mockBody,
        }),
      );
    });

    it('should respect insecure mode', async () => {
      const insecureClient = new BaseServiceClient(
        mockUrl,
        mockCoronerLocation,
        mockCoronerToken,
        true,
      );
      const mockResponse = {data: 'test'};

      mockedAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: mockResponse,
        config: {},
        request: {},
      });

      await insecureClient.request({
        method: 'get',
        path: '/api/test',
      });

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          httpsAgent: expect.objectContaining({
            options: expect.objectContaining({
              rejectUnauthorized: false,
            }),
          }),
        }),
      );
    });

    it('should reject on request error', async () => {
      const mockError = new Error('Network error');

      mockedAxios.mockRejectedValue(mockError);

      await expect(
        client.request({method: 'get', path: '/test'}),
      ).rejects.toEqual(mockError);
    });
  });

  describe('handleResponse', () => {
    it('should handle successful responses', async () => {
      const mockBody = {data: 'test'};
      const result = await client.handleResponse({status: 200}, mockBody);
      expect(result).toEqual(mockBody);
    });

    it('should throw error on HTTP 4xx/5xx with error message', async () => {
      const mockBody = {error: {message: 'Bad request'}};
      await expect(
        client.handleResponse({status: 400}, mockBody),
      ).rejects.toThrow('HTTP status 400: Bad request');
    });

    it('should throw error on HTTP 4xx/5xx without error message', async () => {
      await expect(client.handleResponse({status: 500}, null)).rejects.toThrow(
        'HTTP status 500',
      );
    });
  });

  describe('tokenPager', () => {
    it('should iterate through paginated results', async () => {
      const page1 = {
        values: [{id: 1}, {id: 2}],
        next_page_token: 'token-2',
      };
      const page2 = {
        values: [{id: 3}, {id: 4}],
        next_page_token: 'token-3',
      };
      const page3 = {
        values: [{id: 5}],
        next_page_token: null,
      };

      let callCount = 0;
      mockedAxios.mockImplementation(config => {
        callCount++;
        if (callCount === 1) {
          // First call - initial request
          return Promise.resolve({
            status: 200,
            data: page1,
            statusText: 'OK',
            headers: {},
            config: {},
            request: {},
          });
        } else if (callCount === 2) {
          // Second call should have page_token added
          expect(config.params).toHaveProperty('page_token', 'token-2');
          return Promise.resolve({
            status: 200,
            data: page2,
            statusText: 'OK',
            headers: {},
            config: {},
            request: {},
          });
        } else if (callCount === 3) {
          // Third call should have updated page_token
          expect(config.params).toHaveProperty('page_token', 'token-3');
          return Promise.resolve({
            status: 200,
            data: page3,
            statusText: 'OK',
            headers: {},
            config: {},
            request: {},
          });
        }
        return Promise.reject(new Error('Unexpected call'));
      });

      const results = [];
      for await (const item of client.tokenPager({
        method: 'get',
        path: '/api/list',
      })) {
        results.push(item);
      }

      expect(results).toEqual([{id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}]);
      expect(callCount).toBe(3);
    });

    it('should stop iteration when no values returned', async () => {
      const emptyPage = {
        values: [],
        next_page_token: 'should-not-be-used',
      };

      mockedAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: emptyPage,
        config: {},
        request: {},
      });

      const results = [];
      for await (const item of client.tokenPager({
        method: 'get',
        path: '/api/list',
      })) {
        results.push(item);
      }

      expect(results).toEqual([]);
      expect(mockedAxios).toHaveBeenCalledTimes(1);
    });

    it('should handle POST requests in pagination', async () => {
      const mockBody = {filter: 'active'};
      const page1 = {
        values: [{id: 1}],
        next_page_token: null,
      };

      mockedAxios.mockImplementation(config => {
        expect(config.method).toBe('POST');
        expect(config.data).toEqual(mockBody);
        return Promise.resolve({
          status: 200,
          statusText: 'OK',
          headers: {},
          data: page1,
          config: {},
          request: {},
        });
      });

      const results = [];
      for await (const item of client.tokenPager({
        method: 'post',
        path: '/api/search',
        body: mockBody,
      })) {
        results.push(item);
      }

      expect(results).toEqual([{id: 1}]);
    });
  });
});
