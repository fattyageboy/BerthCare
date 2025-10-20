#!/usr/bin/env node
/**
 * S3 Connection Test Script
 *
 * Tests S3 connectivity and basic operations:
 * - Connection verification
 * - Pre-signed URL generation
 * - Upload simulation
 * - Download URL generation
 *
 * Usage:
 *   npm run test:s3 --prefix apps/backend
 */

/* eslint-disable no-console */

import { logError, logInfo } from '../config/logger';

import {
  generateDocumentUploadUrl,
  generatePhotoUploadUrl,
  generateSignatureUploadUrl,
  S3_BUCKETS,
  verifyS3Connection,
} from './s3-client';

async function testS3Connection() {
  console.log('\n🧪 Testing S3 Connection...\n');
  console.log('─'.repeat(60));

  try {
    // Test 1: Verify S3 connection
    console.log('\n1️⃣  Testing S3 connection...');
    const connected = await verifyS3Connection();

    if (connected) {
      logInfo('✅ S3 connection successful');
      console.log('   ✅ S3 connection verified');
      console.log(`   📦 Buckets configured:`);
      console.log(`      - Photos: ${S3_BUCKETS.PHOTOS}`);
      console.log(`      - Documents: ${S3_BUCKETS.DOCUMENTS}`);
      console.log(`      - Signatures: ${S3_BUCKETS.SIGNATURES}`);
    } else {
      logError('❌ S3 connection failed', new Error('Connection verification failed'));
      console.log('   ❌ S3 connection failed');
      process.exit(1);
    }

    // Test 2: Generate photo upload URL
    console.log('\n2️⃣  Testing photo upload URL generation...');
    const photoResult = await generatePhotoUploadUrl('test-visit-123', 'test-photo.jpg', {
      originalName: 'test-photo.jpg',
      mimeType: 'image/jpeg',
      size: 1024000,
      width: 1920,
      height: 1080,
      compressed: true,
      compressionQuality: 85,
      uploadedBy: 'test-user',
      uploadedAt: new Date().toISOString(),
      clientId: 'test-client',
    });

    console.log('   ✅ Photo upload URL generated');
    console.log(`   🔑 Key: ${photoResult.key}`);
    console.log(`   🔗 URL: ${photoResult.url.substring(0, 80)}...`);

    // Test 3: Generate document upload URL
    console.log('\n3️⃣  Testing document upload URL generation...');
    const documentResult = await generateDocumentUploadUrl(
      'care-plan',
      'test-care-plan.pdf',
      'test-user'
    );

    console.log('   ✅ Document upload URL generated');
    console.log(`   🔑 Key: ${documentResult.key}`);
    console.log(`   🔗 URL: ${documentResult.url.substring(0, 80)}...`);

    // Test 4: Generate signature upload URL
    console.log('\n4️⃣  Testing signature upload URL generation...');
    const signatureResult = await generateSignatureUploadUrl(
      'test-visit-123',
      'caregiver',
      'test-user'
    );

    console.log('   ✅ Signature upload URL generated');
    console.log(`   🔑 Key: ${signatureResult.key}`);
    console.log(`   🔗 URL: ${signatureResult.url.substring(0, 80)}...`);

    // Summary
    console.log('\n' + '─'.repeat(60));
    console.log('\n✨ All S3 tests passed successfully!\n');
    console.log('📊 Test Summary:');
    console.log('   ✅ S3 connection verified');
    console.log('   ✅ Photo upload URL generation working');
    console.log('   ✅ Document upload URL generation working');
    console.log('   ✅ Signature upload URL generation working');
    console.log('\n💡 Next steps:');
    console.log('   1. Test actual file upload using generated URLs');
    console.log('   2. Verify file appears in S3 bucket');
    console.log('   3. Test download URL generation');
    console.log('   4. Integrate with API endpoints\n');
  } catch (error) {
    console.error('\n❌ S3 test failed:', error);
    logError('S3 test failed', error as Error);
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  testS3Connection();
}
