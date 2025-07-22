import request from '@cypress/request';
import * as fs from 'fs';
import {CoronerClient} from '../../lib/coroner';

jest.mock('@cypress/request');
jest.mock('fs');

const mockedRequest = request as jest.Mocked<typeof request>;
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

      mockedRequest.get.mockImplementation((options, callback) => {
        expect(options).toMatchObject({
          uri: `${mockEndpoint}/api/test`,
          qs: {token: mockToken, param: 'value'},
          strictSSL: true,
          timeout: 30000,
          encoding: null,
        });
        callback(null, mockResponse, mockBody);
      });

      client.http_get('/api/test', {param: 'value'}, (error, result) => {
        expect(error).toBeNull();
        expect(result.statusCode).toBe(200);
        expect(result.bodyData).toEqual(mockBody);
        done();
      });
    });

    it('should handle request errors', done => {
      const mockError = new Error('Network error');

      mockedRequest.get.mockImplementation((options, callback) => {
        callback(mockError, null, null);
      });

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

      mockedRequest.get.mockImplementation((options, callback) => {
        callback(null, mockResponse, mockBody);
      });

      client.http_get('/api/test', {}, (error, result) => {
        expect(error).toBeTruthy();
        expect(error.message).toBe('HTTP 404: Not Found');
        expect(error.response_obj).toEqual(mockResponse);
        done();
      });
    });
  });

  describe('post', () => {
    it('should make a POST request with JSON body', done => {
      const mockResponse = {statusCode: 200, headers: {}};
      const mockBody = Buffer.from(JSON.stringify({success: true}));
      const postData = {key: 'value'};

      mockedRequest.post.mockImplementation((options, callback) => {
        expect(options).toMatchObject({
          uri: `${mockEndpoint}/api/create`,
          qs: {token: mockToken},
          body: JSON.stringify(postData),
          headers: {
            'Content-Type': 'application/json',
          },
          strictSSL: true,
          timeout: 30000,
          encoding: 'utf8',
        });
        callback(null, mockResponse, mockBody);
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

      mockedRequest.post.mockImplementation((options, callback) => {
        expect(options.headers['Content-Type']).toBe(
          'application/x-www-form-urlencoded',
        );
        expect(options.body).toMatch(/token=test-token-123/);
        callback(null, mockResponse, mockBody);
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

      mockedRequest.post.mockImplementation((options, callback) => {
        expect(options.headers['Content-Type']).toBe(
          'application/octet-stream',
        );
        expect(options.body).toEqual(binaryData);
        callback(null, mockResponse, mockBody);
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

      mockedRequest.post.mockImplementation((options, callback) => {
        expect(options.headers['Content-Encoding']).toBe('gzip');
        callback(null, mockResponse, mockBody);
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

      mockedRequest.post.mockImplementation((options, callback) => {
        expect(options.uri).toContain('/api/login');
        expect(options.body).toContain('username=testuser');
        expect(options.body).toContain('password=testpass');
        callback(null, mockResponse, mockBody);
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

      mockedRequest.post.mockImplementation((options, callback) => {
        callback(null, mockResponse, mockBody);
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

      mockedRequest.post.mockImplementation((options, callback) => {
        expect(options.uri).toContain('/api/query');
        expect(options.qs).toMatchObject({
          universe: 'test-universe',
          project: 'test-project',
          token: mockToken,
        });
        expect(options.body).toBe(JSON.stringify(queryData));
        callback(null, mockResponse, mockBody);
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

      mockedRequest.get.mockImplementation((options, callback) => {
        expect(options.uri).toContain('/api/get');
        expect(options.qs).toMatchObject({
          universe: 'test-universe',
          project: 'test-project',
          object: 'obj123',
          resource: 'raw',
          token: mockToken,
        });
        callback(null, mockResponse, mockBody);
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

      mockedRequest.post.mockImplementation((options, callback) => {
        expect(options.uri).toContain('/api/post');
        expect(options.formData).toBeDefined();
        expect(options.formData.upload_file).toBeDefined();
        // The attachment key is based on the filename basename
        expect(options.formData['attachment_attachment.log']).toBeDefined();
        callback(null, mockResponse, mockBody);
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

      mockedRequest.post.mockImplementation((options, callback) => {
        expect(options.uri).toContain('/api/delete');
        const body = JSON.parse(options.body);
        expect(body.objects).toEqual(['abc', '7b', 'def']);
        callback(null, mockResponse, mockBody);
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
