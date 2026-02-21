import axios from 'axios';
import {SymboldClient} from '../../lib/symbold';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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

      mockedAxios.get.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: 'OK',
        headers: {},
        data: JSON.parse(mockResponse.body),
        config: {},
        request: {},
      });

      client.get('/test/path');

      setTimeout(() => {
        expect(mockedAxios.get).toHaveBeenCalledWith(
          `${mockEndpoint}/api/symbold/test/path`,
          expect.objectContaining({
            headers: {
              'X-Coroner-Token': mockToken,
              'X-Coroner-Location': mockEndpoint,
            },
          }),
        );
        done();
      }, 0);
    });

    it('should handle GET request with callback', done => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({data: 'test'}),
      };

      mockedAxios.get.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: 'OK',
        headers: {},
        data: JSON.parse(mockResponse.body),
        config: {},
        request: {},
      });

      client.get('/test/path', (err, res) => {
        expect(err).toBeNull();
        expect(res.status).toBe(200);
        done();
      });
    });

    it('should handle error responses', done => {
      const mockError = new Error('Network error');

      mockedAxios.get.mockRejectedValue(mockError);

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

      mockedAxios.get.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: 'Not Found',
        headers: {},
        data: mockResponse.body,
        config: {},
        request: {},
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

      mockedAxios.post.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: 'OK',
        headers: {},
        data: JSON.parse(mockResponse.body),
        config: {},
        request: {},
      });

      client.post('/create', postData, (err, res) => {
        expect(err).toBeNull();
        expect(res.status).toBe(200);

        expect(mockedAxios.post).toHaveBeenCalledWith(
          `${mockEndpoint}/api/symbold/create`,
          postData,
          expect.objectContaining({
            headers: expect.objectContaining({
              'X-Coroner-Token': mockToken,
              'X-Coroner-Location': mockEndpoint,
              'Content-Type': 'application/json',
            }),
          }),
        );
        done();
      });
    });

    it('should handle POST errors', async () => {
      const mockError = new Error('Post failed');
      const postData = {key: 'value'};

      mockedAxios.post.mockRejectedValue(mockError);

      await expect(async () => {
        await client.post('/create', postData);
      }).rejects.toThrow('Post failed');
    });
  });

  describe('put', () => {
    it('should make a PUT request with JSON data', done => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({updated: true}),
      };
      const putData = {key: 'updated'};

      mockedAxios.put.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: 'OK',
        headers: {},
        data: JSON.parse(mockResponse.body),
        config: {},
        request: {},
      });

      client.put('/update', putData, (err, res) => {
        expect(err).toBeNull();
        expect(res.status).toBe(200);

        expect(mockedAxios.put).toHaveBeenCalledWith(
          `${mockEndpoint}/api/symbold/update`,
          putData,
          expect.objectContaining({
            headers: expect.objectContaining({
              'X-Coroner-Token': mockToken,
              'X-Coroner-Location': mockEndpoint,
              'Content-Type': 'application/json',
            }),
          }),
        );
        done();
      });
    });

    it('should handle PUT non-200 responses', done => {
      const mockResponse = {
        statusCode: 400,
        body: 'Bad request',
      };
      const putData = {key: 'value'};

      mockedAxios.put.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: 'Bad Request',
        headers: {},
        data: mockResponse.body,
        config: {},
        request: {},
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

      mockedAxios.delete.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: mockResponse.statusMessage,
        headers: {},
        data: mockResponse.body,
        config: {},
        request: {},
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      client.remove('/delete/123', (err, res) => {
        expect(err).toBeNull();
        expect(res.status).toBe(200);

        expect(mockedAxios.delete).toHaveBeenCalledWith(
          `${mockEndpoint}/api/symbold/delete/123`,
          expect.objectContaining({
            headers: expect.objectContaining({
              'X-Coroner-Token': mockToken,
              'X-Coroner-Location': mockEndpoint,
            }),
            timeout: 30000,
          }),
        );

        // The console.log happens after the callback in the implementation
        setTimeout(() => {
          expect(consoleSpy).toHaveBeenCalledWith('Successfully deleted data');
          consoleSpy.mockRestore();
          done();
        }, 0);
      });
    });

    it('should handle DELETE errors', async () => {
      const mockError = new Error('Delete failed');

      mockedAxios.delete.mockRejectedValue(mockError);

      await expect(async () => {
        await client.remove('/delete/123');
      }).rejects.toThrow('Delete failed');
    });

    it('should handle non-200 DELETE responses', done => {
      const mockResponse = {
        statusCode: 404,
        statusMessage: 'Not Found',
        body: 'Resource not found',
      };

      mockedAxios.delete.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: mockResponse.statusMessage,
        headers: {},
        data: mockResponse.body,
        config: {},
        request: {},
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

      mockedAxios.delete.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: mockResponse.statusMessage,
        headers: {},
        data: mockResponse.body,
        config: {},
        request: {},
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

      mockedAxios.get.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: 'OK',
        headers: {},
        data: JSON.parse(mockResponse.body),
        config: {},
        request: {},
      });

      const argv = {_: ['test-universe']};
      client.status(argv);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${mockEndpoint}/api/symbold/status/universe/test-universe`,
        expect.any(Object),
      );
    });

    it('should make a GET request for project status', () => {
      const mockResponse = {
        statusCode: 200,
        body: JSON.stringify({status: 'ok'}),
      };

      mockedAxios.get.mockResolvedValue({
        status: mockResponse.statusCode,
        statusText: 'OK',
        headers: {},
        data: JSON.parse(mockResponse.body),
        config: {},
        request: {},
      });

      const argv = {_: ['test-universe/test-project']};
      client.status(argv);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${mockEndpoint}/api/symbold/status/universe/test-universe/project/test-project`,
        expect.any(Object),
      );
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
