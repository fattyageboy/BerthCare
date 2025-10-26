import { greet, version } from '../src/index';

describe('Shared Library', () => {
  describe('version', () => {
    it('should export the correct version', () => {
      expect(version).toBe('1.0.0');
    });
  });

  describe('greet', () => {
    it('should return a greeting message', () => {
      const result = greet('Alice');
      expect(result).toBe('Hello, Alice! Welcome to BerthCare.');
    });

    it('should handle empty string', () => {
      const result = greet('');
      expect(result).toBe('Hello, ! Welcome to BerthCare.');
    });

    it('should handle special characters', () => {
      const result = greet('José');
      expect(result).toBe('Hello, José! Welcome to BerthCare.');
    });
  });
});
