import request from '@cypress/request';
import {BaseServiceClient} from '../../lib/baseServiceClient';

jest.mock('@cypress/request');
const mockedRequest = request as jest.Mocked<typeof request>;

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

      mockedRequest.mockImplementation((options, callback) => {
        expect(options).toMatchObject({
          url: `${mockUrl}/api/test`,
          method: 'GET',
          headers: {
            'X-Coroner-Location': mockCoronerLocation,
            'X-Coroner-Token': mockCoronerToken,
          },
          qs: {param: 'value'},
          json: true,
          strictSSL: true,
        });
        callback(null, {statusCode: 200}, mockResponse);
      });

      const result = await client.request({
        method: 'get',
        path: '/api/test',
        qs: {param: 'value'},
      });
      expect(result).toEqual(mockResponse);
    });

    it('should include default query parameters', async () => {
      client.setDefaultQs({universe: 'test', project: 'demo'});
      const mockResponse = {data: 'test'};

      mockedRequest.mockImplementation((options, callback) => {
        expect(options.qs).toEqual({
          universe: 'test',
          project: 'demo',
          param: 'value',
        });
        callback(null, {statusCode: 200}, mockResponse);
      });

      await client.request({
        method: 'get',
        path: '/api/test',
        qs: {param: 'value'},
      });
    });

    it('should filter out undefined and null query parameters', async () => {
      const mockResponse = {data: 'test'};

      mockedRequest.mockImplementation((options, callback) => {
        expect(options.qs).toEqual({valid: 'value'});
        callback(null, {statusCode: 200}, mockResponse);
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
    });

    it('should handle POST requests with body', async () => {
      const mockBody = {key: 'value'};
      const mockResponse = {success: true};

      mockedRequest.mockImplementation((options, callback) => {
        expect(options).toMatchObject({
          method: 'POST',
          body: mockBody,
        });
        callback(null, {statusCode: 201}, mockResponse);
      });

      const result = await client.request({
        method: 'post',
        path: '/api/create',
        body: mockBody,
      });
      expect(result).toEqual(mockResponse);
    });

    it('should respect insecure mode', async () => {
      const insecureClient = new BaseServiceClient(
        mockUrl,
        mockCoronerLocation,
        mockCoronerToken,
        true,
      );
      const mockResponse = {data: 'test'};

      mockedRequest.mockImplementation((options, callback) => {
        expect(options.strictSSL).toBe(false);
        callback(null, {statusCode: 200}, mockResponse);
      });

      await insecureClient.request({
        method: 'get',
        path: '/api/test',
      });
    });

    it('should reject on request error', async () => {
      const mockError = new Error('Network error');

      mockedRequest.mockImplementation((options, callback) => {
        callback(mockError, null, null);
      });

      await expect(
        client.request({method: 'get', path: '/test'}),
      ).rejects.toEqual(mockError);
    });
  });

  describe('handleResponse', () => {
    it('should handle successful responses', async () => {
      const mockBody = {data: 'test'};
      const result = await client.handleResponse({statusCode: 200}, mockBody);
      expect(result).toEqual(mockBody);
    });

    it('should throw error on HTTP 4xx/5xx with error message', async () => {
      const mockBody = {error: {message: 'Bad request'}};
      await expect(
        client.handleResponse({statusCode: 400}, mockBody),
      ).rejects.toThrow('HTTP status 400: Bad request');
    });

    it('should throw error on HTTP 4xx/5xx without error message', async () => {
      await expect(
        client.handleResponse({statusCode: 500}, null),
      ).rejects.toThrow('HTTP status 500');
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
      mockedRequest.mockImplementation((options, callback) => {
        callCount++;
        if (callCount === 1) {
          // First call - initial request
          callback(null, {statusCode: 200}, page1);
        } else if (callCount === 2) {
          // Second call should have page_token added
          expect(options.qs).toHaveProperty('page_token', 'token-2');
          callback(null, {statusCode: 200}, page2);
        } else if (callCount === 3) {
          // Third call should have updated page_token
          expect(options.qs).toHaveProperty('page_token', 'token-3');
          callback(null, {statusCode: 200}, page3);
        }
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

      mockedRequest.mockImplementation((options, callback) => {
        callback(null, {statusCode: 200}, emptyPage);
      });

      const results = [];
      for await (const item of client.tokenPager({
        method: 'get',
        path: '/api/list',
      })) {
        results.push(item);
      }

      expect(results).toEqual([]);
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });

    it('should handle POST requests in pagination', async () => {
      const mockBody = {filter: 'active'};
      const page1 = {
        values: [{id: 1}],
        next_page_token: null,
      };

      mockedRequest.mockImplementation((options, callback) => {
        expect(options.method).toBe('POST');
        expect(options.body).toEqual(mockBody);
        callback(null, {statusCode: 200}, page1);
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
