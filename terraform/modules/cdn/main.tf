# CloudFront CDN Module
# Creates CloudFront distribution for fast asset delivery

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# CloudFront Origin Access Control for S3
resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.project_name}-${var.environment}-oac"
  description                       = "OAC for ${var.project_name} ${var.environment} S3 buckets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
 
# CloudFront Distribution
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} ${var.environment} CDN"
  default_root_object = "index.html"
  price_class         = var.price_class

  # Photos origin
  origin {
    domain_name              = var.photos_bucket_domain_name
    origin_id                = "S3-Photos"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  # Documents origin
  origin {
    domain_name              = var.documents_bucket_domain_name
    origin_id                = "S3-Documents"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  # Signatures origin
  origin {
    domain_name              = var.signatures_bucket_domain_name
    origin_id                = "S3-Signatures"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  # Default cache behavior (photos)
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-Photos"

    forwarded_values {
      query_string = false
      headers      = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400   # 1 day
    max_ttl                = 31536000 # 1 year
    compress               = true
  }

  # Cache behavior for documents
  ordered_cache_behavior {
    path_pattern     = "/documents/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-Documents"

    forwarded_values {
      query_string = false
      headers      = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
    compress               = true
  }

  # Cache behavior for signatures
  ordered_cache_behavior {
    path_pattern     = "/signatures/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-Signatures"

    forwarded_values {
      query_string = false
      headers      = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
    compress               = true
  }

  # Restrictions
  restrictions {
    geo_restriction {
      restriction_type = "whitelist"
      locations        = ["CA", "US"] # Canada and US only
    }
  }

  # SSL/TLS certificate
  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == null
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn != null ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  # Logging
  logging_config {
    include_cookies = false
    bucket          = var.logs_bucket_domain_name
    prefix          = "cloudfront/"
  }

  tags = merge(
    var.tags,
    {
      Name = "${var.project_name}-${var.environment}-cdn"
    }
  )
}

# CloudWatch Alarms for CloudFront monitoring
resource "aws_cloudwatch_metric_alarm" "cloudfront_error_rate" {
  alarm_name          = "${var.project_name}-${var.environment}-cloudfront-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "5xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = "300"
  statistic           = "Average"
  threshold           = "5"
  alarm_description   = "This metric monitors CloudFront 5xx error rate"
  alarm_actions       = var.alarm_actions

  dimensions = {
    DistributionId = aws_cloudfront_distribution.main.id
  }

  tags = var.tags
}
