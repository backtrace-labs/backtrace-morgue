import request from '@cypress/request';
import {SymboldClient} from '../../lib/symbold';

jest.mock('@cypress/request');
const mockedRequest = request as jest.Mocked<typeof request>;

describe('SymboldClient', () => {
  let client: SymboldClient;
  let mockCoronerdClient: any;
  const mockEndpoint = 'https://api.example.com';
  const mockToken = 'test-token-123';

  beforeEach(() => {
    jest.clearAllMocks();
    mockCoronerdClient = {
      endpoint: mockEndpoint,
      debug: false,
      timeout: 30000,
      insecure: false,
      config: {
        token: mockToken,
      },
    };
    client = new SymboldClient(mockCoronerdClient);
  });

  describe('get', () => {
    it('should make a GET request with proper headers', done => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({data: 'test'}),
      };

      mockedRequest.get.mockImplementation((url, options, callback) => {
        expect(url).toBe(`${mockEndpoint}/api/symbold/test/path`);
        expect(options).toMatchObject({
          headers: {
            'X-Coroner-Token': mockToken,
            'X-Coroner-Location': mockEndpoint,
          },
          strictSSL: true,
        });
        callback(null, mockResponse);
      });

      client.get('/test/path');

      setTimeout(() => {
        expect(mockedRequest.get).toHaveBeenCalled();
        done();
      }, 0);
    });

    it('should handle GET request with callback', done => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({data: 'test'}),
      };

      mockedRequest.get.mockImplementation((url, options, callback) => {
        callback(null, mockResponse);
      });

      client.get('/test/path', (err, res) => {
        expect(err).toBeNull();
        expect(res.statusCode).toBe(200);
        done();
      });
    });

    it('should handle error responses', done => {
      const mockError = new Error('Network error');

      mockedRequest.get.mockImplementation((url, options, callback) => {
        callback(mockError, null);
      });

      client.get('/test/path', (err, res) => {
        expect(err).toEqual(mockError);
        done();
      });
    });

    it('should handle non-200 status codes', done => {
      const mockResponse = {
        statusCode: 404,
        body: 'Not found',
      };

      mockedRequest.get.mockImplementation((url, options, callback) => {
        callback(null, mockResponse);
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      client.get('/test/path');

      setTimeout(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Not found');
        consoleSpy.mockRestore();
        done();
      }, 0);
    });
  });

  describe('post', () => {
    it('should make a POST request with JSON data', done => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({success: true}),
      };
      const postData = {key: 'value'};

      mockedRequest.post.mockImplementation((url, options, callback) => {
        expect(url).toBe(`${mockEndpoint}/api/symbold/create`);
        expect(options).toMatchObject({
          body: JSON.stringify(postData),
          headers: {
            'X-Coroner-Token': mockToken,
            'X-Coroner-Location': mockEndpoint,
            'Content-Type': 'application/json',
          },
          strictSSL: true,
        });
        callback(null, mockResponse);
      });

      client.post('/create', postData, (err, res) => {
        expect(err).toBeNull();
        expect(res.statusCode).toBe(200);
        done();
      });
    });

    it('should handle POST errors', () => {
      const mockError = new Error('Post failed');
      const postData = {key: 'value'};

      mockedRequest.post.mockImplementation((url, options, callback) => {
        callback(mockError, null);
      });

      expect(() => {
        client.post('/create', postData);
      }).toThrow('Post failed');
    });
  });

  describe('put', () => {
    it('should make a PUT request with JSON data', done => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({updated: true}),
      };
      const putData = {key: 'updated'};

      mockedRequest.put.mockImplementation((url, options, callback) => {
        expect(url).toBe(`${mockEndpoint}/api/symbold/update`);
        expect(options).toMatchObject({
          body: JSON.stringify(putData),
          headers: {
            'X-Coroner-Token': mockToken,
            'X-Coroner-Location': mockEndpoint,
            'Content-Type': 'application/json',
          },
          strictSSL: true,
        });
        callback(null, mockResponse);
      });

      client.put('/update', putData, (err, res) => {
        expect(err).toBeNull();
        expect(res.statusCode).toBe(200);
        done();
      });
    });

    it('should handle PUT non-200 responses', done => {
      const mockResponse = {
        statusCode: 400,
        body: 'Bad request',
      };
      const putData = {key: 'value'};

      mockedRequest.put.mockImplementation((url, options, callback) => {
        callback(null, mockResponse);
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      client.put('/update', putData);

      setTimeout(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Bad request');
        consoleSpy.mockRestore();
        done();
      }, 0);
    });
  });

  describe('remove', () => {
    it('should make a DELETE request with proper headers', done => {
      const mockResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        body: '',
      };

      mockedRequest.delete.mockImplementation((url, options, callback) => {
        expect(url).toBe(`${mockEndpoint}/api/symbold/delete/123`);
        expect(options).toMatchObject({
          headers: {
            'X-Coroner-Token': mockToken,
            'X-Coroner-Location': mockEndpoint,
          },
          strictSSL: true,
          timeout: 30000,
        });
        callback(null, mockResponse);
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      client.remove('/delete/123', (err, res) => {
        expect(err).toBeNull();
        expect(res.statusCode).toBe(200);
        // The console.log happens after the callback in the implementation
        setTimeout(() => {
          expect(consoleSpy).toHaveBeenCalledWith('Successfully deleted data');
          consoleSpy.mockRestore();
          done();
        }, 0);
      });
    });

    it('should handle DELETE errors', done => {
      const mockError = new Error('Delete failed');

      mockedRequest.delete.mockImplementation((url, options, callback) => {
        callback(mockError, null);
      });

      expect(() => {
        client.remove('/delete/123');
      }).toThrow('Delete failed');
      done();
    });

    it('should handle non-200 DELETE responses', done => {
      const mockResponse = {
        statusCode: 404,
        statusMessage: 'Not Found',
        body: 'Resource not found',
      };

      mockedRequest.delete.mockImplementation((url, options, callback) => {
        callback(null, mockResponse);
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      client.remove('/delete/123');

      setTimeout(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Resource not found');
        consoleSpy.mockRestore();
        done();
      }, 0);
    });

    it('should include debug output when debug is enabled', done => {
      mockCoronerdClient.debug = true;
      client = new SymboldClient(mockCoronerdClient);

      const mockResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        body: '',
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      mockedRequest.delete.mockImplementation((url, options, callback) => {
        callback(null, mockResponse);
      });

      client.remove('/delete/123', (err, res) => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Trying to remove resource'),
        );
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Received status code: 200'),
        );
        consoleSpy.mockRestore();
        done();
      });
    });
  });

  describe('status', () => {
    it('should make a GET request for universe status', () => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({status: 'ok'}),
      };

      mockedRequest.get.mockImplementation((url, options, callback) => {
        expect(url).toBe(
          `${mockEndpoint}/api/symbold/status/universe/test-universe`,
        );
        callback(null, mockResponse);
      });

      const argv = {_: ['test-universe']};
      client.status(argv);

      expect(mockedRequest.get).toHaveBeenCalled();
    });

    it('should make a GET request for project status', () => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({status: 'ok'}),
      };

      mockedRequest.get.mockImplementation((url, options, callback) => {
        expect(url).toBe(
          `${mockEndpoint}/api/symbold/status/universe/test-universe/project/test-project`,
        );
        callback(null, mockResponse);
      });

      const argv = {_: ['test-universe/test-project']};
      client.status(argv);

      expect(mockedRequest.get).toHaveBeenCalled();
    });

    it('should show usage when no arguments provided', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const argv = {_: []};

      client.showSymbolServerUsage = jest.fn();
      client.status(argv);

      expect(client.showSymbolServerUsage).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should show help when help argument is provided', () => {
      const argv = {_: ['help']};

      client.showStatusHelp = jest.fn();
      client.status(argv);

      expect(client.showStatusHelp).toHaveBeenCalled();
    });
  });

  describe('getCoronerdHeaders', () => {
    it('should return proper headers', () => {
      const headers = client.getCoronerdHeaders();
      expect(headers).toEqual({
        'X-Coroner-Token': mockToken,
        'X-Coroner-Location': mockEndpoint,
      });
    });
  });
});
