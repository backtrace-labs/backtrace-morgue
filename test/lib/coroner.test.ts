import axios from 'axios';
import * as fs from 'fs';
import {CoronerClient} from '../../lib/coroner';

jest.mock('axios');
jest.mock('fs');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('CoronerClient', () => {
  let client: CoronerClient;
  const mockEndpoint = 'https://api.example.com';
  const mockToken = 'test-token-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock fs.createReadStream to avoid file not found errors
    (mockedFs.createReadStream as jest.Mock).mockReturnValue({
      pipe: jest.fn(),
      on: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      destroy: jest.fn(),
      read: jest.fn(),
      readable: true,
    });

    client = new CoronerClient({
      endpoint: mockEndpoint,
      config: {token: mockToken},
      debug: false,
      timeout: 30000,
    });
  });

  describe('http_get', () => {
    it('should make a GET request with proper headers and parameters', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({data: 'test'}));

      mockedAxios.get.mockImplementation((url, config) => {
        expect(url).toBe(`${mockEndpoint}/api/test`);
        expect(config).toMatchObject({
          params: {token: mockToken, param: 'value'},
          timeout: 30000,
          responseType: 'arraybuffer',
        });
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.http_get('/api/test', {param: 'value'}, (error, result) => {
        expect(error).toBeNull();
        expect(result.status || result.statusCode).toBe(200);
        expect(result.bodyData).toEqual(mockBody);
        done();
      });
    });

    it('should handle request errors', done => {
      const mockError = new Error('Network error');

      mockedAxios.get.mockRejectedValue(mockError);

      client.http_get('/api/test', {}, (error, result) => {
        expect(error).toEqual(mockError);
        expect(result).toBeUndefined();
        done();
      });
    });

    it('should handle non-200 status codes', done => {
      const mockResponse = {
        statusCode: 404,
        statusMessage: 'Not Found',
        headers: {},
      };
      const mockBody = Buffer.from('Not found');

      mockedAxios.get.mockRejectedValue({
        response: {
          status: mockResponse.statusCode,
          statusText: mockResponse.statusMessage,
          headers: mockResponse.headers,
          data: mockBody,
        },
      });

      client.http_get('/api/test', {}, (error, result) => {
        expect(error).toBeTruthy();
        expect(error.message).toBe('HTTP 404: Not Found');
        expect(error.response_obj).toBeDefined();
        done();
      });
    });
  });

  describe('post', () => {
    it('should make a POST request with JSON body', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({success: true}));
      const postData = {key: 'value'};

      mockedAxios.post.mockImplementation((url, data, config) => {
        expect(url).toBe(`${mockEndpoint}/api/create`);
        expect(data).toBe(JSON.stringify(postData));
        expect(config).toMatchObject({
          params: {token: mockToken},
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
          responseType: 'arraybuffer',
        });
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.post('/api/create', {}, postData, null, (error, result) => {
        expect(error).toBeNull();
        expect(result).toEqual({success: true});
        done();
      });
    });

    it('should handle form-urlencoded data when no body is provided', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({success: true}));

      mockedAxios.post.mockImplementation((url, data, config) => {
        expect(config.headers['Content-Type']).toBe(
          'application/x-www-form-urlencoded',
        );
        expect(data).toMatch(/token=test-token-123/);
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.post('/api/create', {}, null, null, (error, result) => {
        expect(error).toBeNull();
        done();
      });
    });

    it('should handle binary data with proper content type', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({success: true}));
      const binaryData = Buffer.from([0x01, 0x02, 0x03]);

      mockedAxios.post.mockImplementation((url, data, config) => {
        expect(config.headers['Content-Type']).toBe('application/octet-stream');
        expect(data).toEqual(binaryData);
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.post(
        '/api/upload',
        {},
        binaryData,
        {binary: true},
        (error, result) => {
          expect(error).toBeNull();
          done();
        },
      );
    });

    it('should apply compression when specified', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({success: true}));

      mockedAxios.post.mockImplementation((url, data, config) => {
        expect(config.headers['Content-Encoding']).toBe('gzip');
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.post(
        '/api/compress',
        {},
        {},
        {compression: 'gzip'},
        (error, result) => {
          expect(error).toBeNull();
          done();
        },
      );
    });
  });

  describe('login', () => {
    it('should login with username and password', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({token: 'new-token'}));

      mockedAxios.post.mockImplementation((url, data, config) => {
        expect(url).toContain('/api/login');
        expect(data).toContain('username=testuser');
        expect(data).toContain('password=testpass');
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.login('testuser', 'testpass', error => {
        expect(error).toBeNull();
        expect(client.config.token).toBe('new-token');
        done();
      });
    });

    it('should handle login errors', done => {
      const mockResponse = {
        statusCode: 401,
        statusMessage: 'Unauthorized',
        headers: {},
      };
      const mockBody = Buffer.from(
        JSON.stringify({error: {message: 'Invalid credentials'}}),
      );

      mockedAxios.post.mockRejectedValue({
        response: {
          status: mockResponse.statusCode,
          statusText: mockResponse.statusMessage,
          headers: mockResponse.headers,
          data: mockBody,
        },
      });

      client.login('testuser', 'wrongpass', error => {
        expect(error).toBeTruthy();
        expect(error.message).toBe('HTTP 401: Unauthorized');
        done();
      });
    });
  });

  describe('query', () => {
    it('should execute a query request', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({results: []}));
      const queryData = {filter: 'test'};

      mockedAxios.post.mockImplementation((url, data, config) => {
        expect(url).toContain('/api/query');
        expect(config.params).toMatchObject({
          universe: 'test-universe',
          project: 'test-project',
          token: mockToken,
        });
        expect(data).toBe(JSON.stringify(queryData));
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.query(
        'test-universe',
        'test-project',
        queryData,
        (error, result) => {
          expect(error).toBeNull();
          expect(result).toEqual({results: []});
          done();
        },
      );
    });
  });

  describe('fetch', () => {
    it('should fetch an object with default resource type', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from('object content');

      mockedAxios.get.mockImplementation((url, config) => {
        expect(url).toContain('/api/get');
        expect(config.params).toMatchObject({
          universe: 'test-universe',
          project: 'test-project',
          object: 'obj123',
          resource: 'raw',
          token: mockToken,
        });
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.fetch(
        'test-universe',
        'test-project',
        'obj123',
        null,
        (error, result) => {
          expect(error).toBeNull();
          expect(result).toEqual(mockBody);
          done();
        },
      );
    });
  });

  describe('post_form', () => {
    it('should post form data with file and attachments', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({uploaded: true}));
      const mockFile = '/path/to/file.txt';
      const mockAttachments = [{filename: '/path/to/attachment.log'}];

      mockedAxios.post.mockImplementation((url, data, config) => {
        expect(url).toContain('/api/post');
        // With axios, form data is sent as FormData object
        expect(data).toBeDefined();
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.post_form(
        mockFile,
        mockAttachments,
        {universe: 'test'},
        (error, result) => {
          expect(error).toBeNull();
          expect(result).toEqual({uploaded: true});
          done();
        },
      );
    });
  });

  describe('delete_objects', () => {
    it('should delete multiple objects by ID', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({deleted: 3}));
      const objectIds = ['abc', 123, 'def'];

      mockedAxios.post.mockImplementation((url, data, config) => {
        expect(url).toContain('/api/delete');
        const body = JSON.parse(data);
        expect(body.objects).toEqual(['abc', '7b', 'def']);
        return Promise.resolve({
          status: mockResponse.statusCode,
          statusText: 'OK',
          headers: mockResponse.headers,
          data: mockBody,
          config: {},
          request: {},
        });
      });

      client.delete_objects(
        'test-universe',
        'test-project',
        objectIds,
        {},
        (error, result) => {
          expect(error).toBeNull();
          expect(result).toEqual({deleted: 3});
          done();
        },
      );
    });
  });

  describe('find_service', () => {
    it('should find service endpoint from config', async () => {
      const mockConfig = {
        services: [
          {name: 'symbold', endpoint: '/api/symbold'},
          {name: 'metrics-importer', endpoint: 'https://metrics.example.com'},
        ],
      };

      // Mock get_config method to return our mock config
      jest.spyOn(client, 'get_config').mockResolvedValue(mockConfig);

      const endpoint = await client.find_service('symbold');
      expect(endpoint).toBe(`${mockEndpoint}/api/symbold`);

      const absoluteEndpoint = await client.find_service('metrics-importer');
      expect(absoluteEndpoint).toBe('https://metrics.example.com');
    });

    it('should throw error for non-existent service', async () => {
      const mockConfig = {
        services: [],
      };

      // Mock get_config method to return our mock config
      jest.spyOn(client, 'get_config').mockResolvedValue(mockConfig);

      await expect(client.find_service('nonexistent')).rejects.toThrow(
        'No nonexistent service is configured',
      );
    });
  });
});
