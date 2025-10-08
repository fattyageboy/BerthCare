describe('Sample Test Suite', () => {
  it('should pass a basic test', () => {
    expect(true).toBe(true);
  });

  it('should perform basic arithmetic', () => {
    expect(2 + 2).toBe(4);
  });

  it('should handle string operations', () => {
    const greeting = 'Hello, BerthCare!';
    expect(greeting).toContain('BerthCare');
  });
});
